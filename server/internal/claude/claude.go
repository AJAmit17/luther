// Package claude: the Claude Code adapter. One headless `claude -p` per open
// thread, speaking Claude Code's stream-json protocol (what its Agent SDK uses).
package claude

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/AJAmit17/luther/server/internal/claudeaccounts"
	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/env"
	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/AJAmit17/luther/server/internal/uploads"
	"github.com/AJAmit17/luther/server/internal/usage"
)

// Claude runtime: one headless `claude -p` per open thread, speaking Claude
// Code's stream-json protocol (what its Agent SDK uses). Verified wire facts:
//   - without --permission-prompt-tool stdio, permission asks are silently denied;
//   - `init` arrives after the first stdin turn, re-emitted per turn; /clear → new session_id;
//   - every content block lands as its own `assistant` event; tool_use before its can_use_tool;
//   - the CLI echoes our control_responses; subagent events carry parent_tool_use_id;
//   - --resume <id> --fork-session --session-id <new> forks to a chosen id.

var Bin = "claude"

var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

var modes = map[string]string{protocol.ModeAsk: "default", protocol.ModeEdits: "acceptEdits", protocol.ModePlan: "plan", protocol.ModeFull: "bypassPermissions"}

func fromMode(m string) string {
	for k, v := range modes {
		if v == m {
			return k
		}
	}
	return protocol.ModeAsk
}

var ErrHeld = errors.New("this session is open in a CLI outside Luther; move it here or fork it")

type runtime struct {
	t   *hub.Thread
	cmd *exec.Cmd

	inMu sync.Mutex
	in   io.WriteCloser

	toolsFile string // Luther's tool config for this claude (holds its token); removed when it exits
	account   string // the Claude account it runs under ("" = the CLI's login)

	compacted bool              // next user text is the compaction summary (hub lock)
	agents    map[string]string // subagent call id → its description (hub lock)
}

type promptData struct {
	input     map[string]any
	decisions []decision // parallel to Options
}

type decision struct {
	allow bool
	perms any // updatedPermissions sent with an allow
}

// Open spawns a claude for the request: a new session, a resume or a fork. The
// thread is not registered yet (hub.Register). ErrHeld: a CLI outside Luther has
// the session open and r.Move wasn't set.
func Open(r protocol.OpenReq) (*hub.Thread, error) {
	if r.Resume != "" && !uuidRe.MatchString(r.Resume) {
		return nil, fmt.Errorf("bad session id")
	}
	if r.Resume != "" && !r.Fork && heldOutside(r.Resume) {
		if !r.Move {
			return nil, ErrHeld
		}
		if err := takeOver(r.Resume); err != nil {
			return nil, err
		}
	}
	sid := text.NewUUID()
	var err error
	args := []string{"-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
		"--include-partial-messages", "--replay-user-messages", "--permission-prompt-tool", "stdio"}
	switch {
	case r.Fork:
		args = append(args, "--resume", r.Resume, "--fork-session", "--session-id", sid)
	case r.Resume != "":
		sid = r.Resume
		args = append(args, "--resume", sid)
	default:
		args = append(args, "--session-id", sid)
	}
	mode := text.OrDefault(r.Mode, protocol.ModeAsk)
	args = append(args, "--permission-mode", modes[mode])
	if r.Model != "" {
		args = append(args, "--model", r.Model)
	}
	if r.Unattended { // deny rules hold in every mode, bypass included
		deny := []string{"AskUserQuestion"}
		for _, c := range protocol.Blocked {
			deny = append(deny, "Bash("+c+":*)")
		}
		args = append(append(args, "--disallowedTools"), deny...) // one argument each: rules contain spaces
	}
	toolsFile := ""
	if r.Tools != nil {
		// In a file only you can read, not on the command line: ps shows arguments.
		if toolsFile, err = toolConfig(sid, r.Tools); err != nil {
			return nil, err
		}
		args = append(args, "--mcp-config", toolsFile, "--allowedTools", "mcp__luther") // Luther's own tools never ask
	}

	cmd := exec.Command(Bin, args...)
	cmd.Dir = r.Cwd
	account, accountEnv := claudeaccounts.Env()                                       // none: the CLI's own login
	cmd.Env = append(append(os.Environ(), "MCP_TOOL_TIMEOUT=1860000"), accountEnv...) // wait_for_thread may wait 30 minutes
	cmd.Stderr = &env.LogTail{Prefix: "claude " + sid[:8] + ": "}
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		os.Remove(toolsFile)
		return nil, err
	}
	// A resumed session's effort is the one its last reply used (Claude keeps
	// it there, not in what it streams).
	effort := ""
	if r.Resume != "" {
		effort = lastEffort(r.Resume)
	}
	t := hub.New(sid, protocol.State{Provider: protocol.Claude, Session: sid, Cwd: r.Cwd, Mode: mode, Model: r.Model, Effort: effort})
	rt := &runtime{t: t, cmd: cmd, in: in, toolsFile: toolsFile, account: account}
	t.SetRuntime(rt)
	if r.Resume != "" {
		t.SetHistory(history(r.Resume))
	}
	go rt.read(out)
	return t, nil
}

// toolConfig writes the MCP config for Luther's tools to ~/.luther/mcp/<sid>.json (0600).
func toolConfig(sid string, ts *protocol.ToolServer) (string, error) {
	b, _ := json.Marshal(map[string]any{"mcpServers": map[string]any{"luther": map[string]any{
		"type": "stdio", "command": ts.Command, "args": ts.Args, "env": ts.Env}}})
	dir := filepath.Join(config.Dir(), "mcp")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	f := filepath.Join(dir, sid+".json")
	return f, os.WriteFile(f, b, 0o600)
}

// ---- stdout ----

type streamRec struct {
	chatRec
	SessionID       string          `json:"session_id"`
	ParentToolUseID *string         `json:"parent_tool_use_id"`
	Model           string          `json:"model"`
	PermissionMode  string          `json:"permissionMode"`
	SlashCommands   []string        `json:"slash_commands"`
	EstimatedTokens int             `json:"estimated_tokens"`
	IsReplay        bool            `json:"isReplay"`
	Event           json.RawMessage `json:"event"`
	RequestID       string          `json:"request_id"`
	Request         json.RawMessage `json:"request"`
	Response        struct {
		RequestID string `json:"request_id"`
	} `json:"response"`
	RateLimit    json.RawMessage `json:"rate_limit_info"`
	FastState    string          `json:"fast_mode_state"`
	FastOff      string          `json:"fast_mode_disabled_reason"`
	TotalCostUSD float64         `json:"total_cost_usd"`
	Usage        struct {
		InputTokens      int64 `json:"input_tokens"`
		OutputTokens     int64 `json:"output_tokens"`
		CacheReadTokens  int64 `json:"cache_read_input_tokens"`
		CacheWriteTokens int64 `json:"cache_creation_input_tokens"`
	} `json:"usage"`
}

func (c *runtime) read(out io.Reader) {
	br := bufio.NewReaderSize(out, 1<<20)
	for {
		line, err := br.ReadBytes('\n')
		if len(line) > 1 {
			c.handle(line)
		}
		if err != nil {
			break
		}
	}
	c.cmd.Wait()
	if c.toolsFile != "" {
		os.Remove(c.toolsFile)
	}
	c.t.End()
}

func (c *runtime) handle(line []byte) {
	var r streamRec
	if json.Unmarshal(line, &r) != nil {
		return
	}
	t := c.t
	effort := ""
	if r.Type == "result" { // the effort the reply used: Claude writes it only to its transcript
		effort = lastEffort(t.State().Session)
	}
	t.Do(func(st *protocol.State) {
		sub := r.ParentToolUseID != nil && *r.ParentToolUseID != "" // a subagent's events
		switch r.Type {
		case "system":
			switch r.Subtype {
			case "init":
				if r.SessionID != "" && r.SessionID != st.Session { // /clear started a new conversation
					st.Session = r.SessionID
					t.Reset([]protocol.Msg{{ID: "clear-" + r.SessionID, Role: "system", Text: "Conversation cleared"}})
				}
				st.Model, st.Mode = r.Model, fromMode(r.PermissionMode)
				fastState(st, r.FastState, r.FastOff)
				if r.SlashCommands != nil {
					st.Commands = r.SlashCommands
				}
			case "status":
				if !sub {
					st.Activity = "Working…"
				}
			case "thinking_tokens":
				if !sub {
					st.Activity = fmt.Sprintf("Thinking… (%d tokens)", r.EstimatedTokens)
				}
			case "compact_boundary":
				c.compacted = true
				t.Add(protocol.Msg{ID: "compact-" + r.UUID, Role: "system", Text: "Context compacted"})
			}

		case "stream_event":
			if sub {
				st.Activity = c.agentLabel(*r.ParentToolUseID) + " working…"
				return
			}
			var ev struct {
				Type         string                      `json:"type"`
				ContentBlock struct{ Type, Name string } `json:"content_block"`
				Delta        struct{ Type, Text string } `json:"delta"`
			}
			json.Unmarshal(r.Event, &ev)
			switch {
			case ev.Type == "content_block_start" && ev.ContentBlock.Type == "text":
				st.Activity = ""
				t.ResetDraft()
			case ev.Type == "content_block_start" && ev.ContentBlock.Type == "tool_use":
				st.Activity = "Running " + ev.ContentBlock.Name + "…"
			case ev.Type == "content_block_start" && ev.ContentBlock.Type == "thinking":
				st.Activity = "Thinking…"
			case ev.Type == "content_block_delta" && ev.Delta.Type == "text_delta":
				t.Delta(ev.Delta.Text)
			}

		case "assistant":
			if sub { // a subagent's step: shown under its call
				for _, m := range recMsgs(r.chatRec) {
					m.Parent = *r.ParentToolUseID
					t.Add(m)
					if m.Role == "tool" {
						st.Activity = c.agentLabel(m.Parent) + ": " + text.Clip(strings.TrimSpace(m.Tool+" "+m.Text), 60)
					}
				}
				return
			}
			if r.hidden() {
				return
			}
			for _, m := range recMsgs(r.chatRec) {
				if isAgentTool(m.Tool) {
					if c.agents == nil {
						c.agents = map[string]string{}
					}
					c.agents[m.ID] = m.Text
				}
				t.Add(m)
			}
			if tasks, ok := todos(r.chatRec); ok {
				st.Tasks = tasks
			}

		case "user":
			if sub || r.hidden() {
				return
			}
			msgs := recMsgs(r.chatRec)
			if c.compacted && len(msgs) > 0 && msgs[0].Role == "user" {
				c.compacted = false // compaction summary, stored as a user prompt
				return
			}
			for _, m := range msgs {
				if r.IsReplay && m.Role == "user" && !strings.HasPrefix(m.Text, "[Request interrupted") {
					t.TurnStart()
				}
				if model := modelSet(m); model != "" {
					st.Model = model // a typed /model: Claude only says so in its output
				}
				if e := effortSet(m); e != "" {
					st.Effort = e // a typed /effort, likewise
				}
				t.Add(m)
			}

		case "rate_limit_event":
			saveLimits(r.RateLimit, c.account)

		case "control_request":
			c.onRequest(r.RequestID, r.Request)

		case "control_response": // the CLI echoes our answers; a prompt may already be gone
			t.ClosePrompt(r.Response.RequestID)

		case "result":
			u := st.Usage
			if u == nil {
				u = &protocol.Usage{}
			}
			u.InputTokens += r.Usage.InputTokens
			u.OutputTokens += r.Usage.OutputTokens
			u.CacheReadTokens += r.Usage.CacheReadTokens
			u.CacheWriteTokens += r.Usage.CacheWriteTokens
			u.CostUSD += r.TotalCostUSD
			u.CostReported = true
			st.Usage = u
			fastState(st, r.FastState, r.FastOff)
			if effort != "" {
				st.Effort = effort
			}
			t.TurnEnd()
		}
	})
	if r.Type == "result" {
		st := t.State()
		id := "claude/cost/" + st.Session + "/" + text.OrDefault(r.UUID, text.RandHex(12))
		if err := usage.Record(id, protocol.Claude, "", time.Now(), protocol.Usage{CostUSD: r.TotalCostUSD, CostReported: true}); err != nil {
			log.Printf("save Claude cost: %v", err)
		}
	}
}

// onRequest: hub lock held.
func (c *runtime) onRequest(id string, raw json.RawMessage) {
	var q struct {
		Subtype     string          `json:"subtype"`
		ToolName    string          `json:"tool_name"`
		Input       map[string]any  `json:"input"`
		Description string          `json:"description"`
		Suggestions json.RawMessage `json:"permission_suggestions"`
	}
	json.Unmarshal(raw, &q)
	if q.Subtype != "can_use_tool" {
		// No SDK hooks or MCP servers are registered, so nothing else should come;
		// answer anyway so claude never blocks on us.
		go c.write(map[string]any{"type": "control_response", "response": map[string]any{
			"subtype": "error", "request_id": id, "error": "unsupported by luther: " + q.Subtype}})
		return
	}
	cp := &promptData{input: q.Input}
	p := &protocol.Prompt{ID: id, Tool: q.ToolName, Priv: cp}
	switch q.ToolName {
	case "AskUserQuestion":
		p.Kind, p.Title = "question", "Claude has a question"
		b, _ := json.Marshal(q.Input["questions"])
		json.Unmarshal(b, &p.Questions)
		for i := range p.Questions {
			p.Questions[i].ID = p.Questions[i].Question // claude keys answers by question text
		}
	case "ExitPlanMode":
		p.Kind, p.Title = "plan", "Ready to code?"
		p.Body, _ = q.Input["plan"].(string)
		p.Options = []protocol.Option{{Label: "Yes, and auto-accept edits"}, {Label: "Yes, and approve each edit"}, {Label: "No, keep planning"}}
		cp.decisions = []decision{
			{allow: true, perms: []map[string]string{{"type": "setMode", "mode": "acceptEdits", "destination": "session"}}},
			{allow: true},
			{allow: false},
		}
	default:
		p.Kind, p.Title = "permission", "Allow "+q.ToolName+"?"
		p.Body = promptBody(q.ToolName, q.Description, q.Input)
		p.Options = []protocol.Option{{Label: "Yes"}}
		cp.decisions = []decision{{allow: true}}
		if len(q.Suggestions) > 2 && string(q.Suggestions) != "null" {
			p.Options = append(p.Options, protocol.Option{Label: "Yes, and don't ask again", Desc: suggestionText(q.Suggestions)})
			cp.decisions = append(cp.decisions, decision{allow: true, perms: q.Suggestions})
		}
		p.Options = append(p.Options, protocol.Option{Label: "No"})
		cp.decisions = append(cp.decisions, decision{allow: false})
	}
	c.t.AddPrompt(p)
}

func promptBody(tool, desc string, in map[string]any) string {
	var b strings.Builder
	if desc != "" {
		b.WriteString(desc + "\n")
	}
	str := func(k string) string { s, _ := in[k].(string); return s }
	switch {
	case str("command") != "":
		b.WriteString("$ " + text.Clip(str("command"), 2000))
	case str("old_string") != "" || str("new_string") != "":
		fmt.Fprintf(&b, "%s\n- %s\n+ %s", str("file_path"), text.Clip(str("old_string"), 800), text.Clip(str("new_string"), 800))
	case str("file_path") != "":
		b.WriteString(str("file_path"))
		if c := str("content"); c != "" {
			b.WriteString("\n" + text.Clip(c, 1200))
		}
	default:
		if s := toolSummary(tool, in); s != "" && s != desc {
			b.WriteString(s)
		}
	}
	return strings.TrimSpace(b.String())
}

// suggestionText: human words for permission_suggestions, e.g. "accept edits for this session".
func suggestionText(raw json.RawMessage) string {
	var ss []struct {
		Type, Mode string
		Rules      []struct {
			ToolName    string `json:"toolName"`
			RuleContent string `json:"ruleContent"`
		}
	}
	json.Unmarshal(raw, &ss)
	var out []string
	for _, s := range ss {
		switch {
		case s.Type == "setMode" && s.Mode == "acceptEdits":
			out = append(out, "accept edits for this session")
		case s.Type == "setMode":
			out = append(out, "switch to "+s.Mode+" mode")
		default:
			for _, r := range s.Rules {
				out = append(out, strings.TrimSpace(r.ToolName+" "+r.RuleContent))
			}
		}
	}
	return strings.Join(out, ", ")
}

// ---- stdin ----

func (c *runtime) write(v any) error {
	b, _ := json.Marshal(v)
	c.inMu.Lock()
	defer c.inMu.Unlock()
	_, err := c.in.Write(append(b, '\n'))
	return err
}

// Send queues a user turn (claude queues it if a turn is running); slash
// commands are plain text. Images go as image blocks; other files as paths to read.
func (c *runtime) Send(msg string, files []string) error {
	var content any = msg
	if len(files) > 0 {
		var blocks []map[string]any
		var other []string
		for _, f := range files {
			if b, mt, ok := uploads.ForAgent(f); ok {
				blocks = append(blocks, map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": mt, "data": base64.StdEncoding.EncodeToString(b)}})
			} else {
				other = append(other, f)
			}
		}
		if len(other) > 0 {
			msg += "\n\nAttached files: " + strings.Join(other, ", ")
		}
		content = append(blocks, map[string]any{"type": "text", "text": text.OrDefault(msg, "(see attachment)")})
	}
	return c.write(map[string]any{"type": "user", "message": map[string]any{"role": "user", "content": content}})
}

func (c *runtime) control(req map[string]any) error {
	return c.write(map[string]any{"type": "control_request", "request_id": "luther-" + text.RandHex(6), "request": req})
}

// Compact: Claude Code's own /compact.
func (c *runtime) Compact() error { return c.Send("/compact", nil) }

func (c *runtime) Interrupt() error { return c.control(map[string]any{"subtype": "interrupt"}) }

// SetMode / SetModel: Claude applies them at once; the state shows them right
// away (Claude's next init reports the same).
func (c *runtime) SetMode(m string) error {
	if err := c.control(map[string]any{"subtype": "set_permission_mode", "mode": modes[m]}); err != nil {
		return err
	}
	c.t.Do(func(st *protocol.State) { st.Mode = m })
	return nil
}

func (c *runtime) SetModel(m string) error {
	if m == "" {
		return errors.New("empty model")
	}
	if err := c.control(map[string]any{"subtype": "set_model", "model": m}); err != nil {
		return err
	}
	c.t.Do(func(st *protocol.State) { st.Model = m })
	return nil
}

// SetEffort / SetFast: session-only flag settings (what /effort and /fast
// change), applied from the next request; nothing is saved to Claude's settings.
func (c *runtime) SetEffort(e string) error {
	if !effortRe.MatchString(e) {
		return fmt.Errorf("bad effort %q", e)
	}
	if err := c.control(map[string]any{"subtype": "apply_flag_settings", "settings": map[string]any{"effortLevel": e}}); err != nil {
		return err
	}
	c.t.Do(func(st *protocol.State) { st.Effort = e })
	return nil
}

// ponytail: Claude reports fast mode only with each turn, so the tile shows the
// state Claude reports after the next turn; an account without fast mode then reads n/a.
func (c *runtime) SetFast(on bool) error {
	if err := c.control(map[string]any{"subtype": "apply_flag_settings", "settings": map[string]any{"fastMode": on}}); err != nil {
		return err
	}
	c.t.Do(func(st *protocol.State) { st.Fast = map[bool]string{true: "on", false: "off"}[on] })
	return nil
}

var effortRe = regexp.MustCompile(`^[a-z]{1,16}$`)

// fastState: Claude's fast_mode_state and why it can't serve; "" (n/a) when
// the account or model can't have it. Until Luther turns fast mode on, Claude
// says only that nobody asked (sdk_opt_in_required): that tells nothing, so
// the model list's answer stands.
func fastState(st *protocol.State, state, off string) {
	switch {
	case state == "" || off == "sdk_opt_in_required":
	case off == "":
		st.Fast, st.FastNote = map[bool]string{true: "on", false: "off"}[state == "on"], ""
	default:
		st.Fast, st.FastNote = "", fastWhy[off]
	}
}

var fastWhy = map[string]string{
	"free":                 "Needs a paid plan",
	"preference":           "Off for your organization",
	"extra_usage_disabled": "Needs usage credits",
	"network_error":        "Unreachable right now",
	"not_first_party":      "Anthropic API only",
	"disabled_by_env":      "Turned off on the Mac",
	"model_not_allowed":    "Not for this model",
}

// effortSet: the level a typed "/effort" set, from "Set effort level to low
// (this session only): …"; "" for any other message.
func effortSet(m protocol.Msg) string {
	rest, ok := strings.CutPrefix(m.Text, "Set effort level to ")
	if m.Role != "system" || !ok {
		return ""
	}
	if f := strings.Fields(rest); len(f) > 0 && effortRe.MatchString(f[0]) {
		return f[0]
	}
	return ""
}

func (c *runtime) Answer(p *protocol.Prompt, a protocol.Answer) error {
	cp := p.Priv.(*promptData)
	resp := map[string]any{"behavior": "deny", "message": text.OrDefault(a.Message, "The user declined this.")}
	switch {
	case p.Kind == "question":
		if len(a.Answers) > 0 {
			in := map[string]any{}
			for k, v := range cp.input {
				in[k] = v
			}
			ans := map[string]string{}
			for q, labels := range a.Answers {
				ans[q] = strings.Join(labels, ", ")
			}
			in["answers"] = ans
			resp = map[string]any{"behavior": "allow", "updatedInput": in}
		}
	case a.Choice >= 0 && a.Choice < len(cp.decisions) && cp.decisions[a.Choice].allow:
		resp = map[string]any{"behavior": "allow", "updatedInput": cp.input}
		if d := cp.decisions[a.Choice]; d.perms != nil {
			resp["updatedPermissions"] = d.perms
		}
	case p.Kind == "plan":
		resp["message"] = text.OrDefault(a.Message, "The user wants to keep planning.")
	}
	return c.write(map[string]any{"type": "control_response", "response": map[string]any{
		"subtype": "success", "request_id": p.ID, "response": resp}})
}

// Stop closes stdin (claude exits after its current turn); kills after 10s.
func (c *runtime) Stop() {
	c.inMu.Lock()
	c.in.Close()
	c.inMu.Unlock()
	go func() {
		time.Sleep(10 * time.Second)
		if !c.t.Ended() {
			c.cmd.Process.Kill()
		}
	}()
}

func (c *runtime) agentLabel(id string) string {
	if d := c.agents[id]; d != "" {
		return "Subagent (" + text.Clip(d, 30) + ")"
	}
	return "Subagent"
}

// modelSet: the model a "/model" command switched to, from Claude's
// "Set model to haiku (claude-haiku-5-5)"; "" for any other message.
func modelSet(m protocol.Msg) string {
	rest, ok := strings.CutPrefix(m.Text, "Set model to ")
	if m.Role != "system" || !ok {
		return ""
	}
	if i, j := strings.LastIndex(rest, "("), strings.LastIndex(rest, ")"); i >= 0 && j > i {
		return strings.TrimSpace(rest[i+1 : j])
	}
	return strings.TrimSpace(rest)
}

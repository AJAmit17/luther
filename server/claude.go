package main

import (
	"bufio"
	"bytes"
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
	"syscall"
	"time"
)

// Claude runtime: one headless `claude -p` per open thread, speaking Claude
// Code's stream-json protocol (what its Agent SDK uses). Verified wire facts:
//   - without --permission-prompt-tool stdio, permission asks are silently denied;
//   - `init` arrives after the first stdin turn, re-emitted per turn; /clear → new session_id;
//   - every content block lands as its own `assistant` event; tool_use before its can_use_tool;
//   - the CLI echoes our control_responses; subagent events carry parent_tool_use_id;
//   - --resume <id> --fork-session --session-id <new> forks to a chosen id.

var claudeBin = "claude"

var claudeModes = map[string]string{ModeAsk: "default", ModeEdits: "acceptEdits", ModePlan: "plan", ModeFull: "bypassPermissions"}

func fromClaudeMode(m string) string {
	for k, v := range claudeModes {
		if v == m {
			return k
		}
	}
	return ModeAsk
}

var errHeld = errors.New("this session is open in a CLI outside Luther; move it here or fork it")

type claudeRT struct {
	t   *Thread
	cmd *exec.Cmd

	inMu sync.Mutex
	in   io.WriteCloser

	compacted bool // next user text is the compaction summary (hub lock)
}

type claudePrompt struct {
	input     map[string]any
	decisions []claudeDecision // parallel to Options
}

type claudeDecision struct {
	allow bool
	perms any // updatedPermissions sent with an allow
}

// openClaude spawns a claude for the request. Callers hold threads' lock.
func openClaude(r OpenReq) (*Thread, error) {
	if r.Resume != "" && !uuidRe.MatchString(r.Resume) {
		return nil, fmt.Errorf("bad session id")
	}
	if r.Resume != "" && !r.Fork && claudeHeldOutside(r.Resume) {
		if !r.Move {
			return nil, errHeld
		}
		if err := claudeTakeOver(r.Resume); err != nil {
			return nil, err
		}
	}
	sid := newUUID()
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
	mode := orDefault(r.Mode, ModeAsk)
	args = append(args, "--permission-mode", claudeModes[mode])
	if r.Model != "" {
		args = append(args, "--model", r.Model)
	}

	cmd := exec.Command(claudeBin, args...)
	cmd.Dir = r.Cwd
	cmd.Stderr = &logTail{prefix: "claude " + sid[:8] + ": "}
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	t := newThread(sid, State{Provider: Claude, Session: sid, Cwd: r.Cwd, Mode: mode, Model: r.Model})
	rt := &claudeRT{t: t, cmd: cmd, in: in}
	t.rt = rt
	if r.Resume != "" {
		// ponytail: parsed under the registry lock; move it out if huge transcripts stall other opens.
		t.msgs = claudeHistory(r.Resume)
	}
	threads.m[sid] = t
	go rt.read(out)
	return t, nil
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
	TotalCostUSD float64 `json:"total_cost_usd"`
	Usage        struct {
		InputTokens  int64 `json:"input_tokens"`
		OutputTokens int64 `json:"output_tokens"`
	} `json:"usage"`
}

func (c *claudeRT) read(out io.Reader) {
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
	c.t.end()
}

func (c *claudeRT) handle(line []byte) {
	var r streamRec
	if json.Unmarshal(line, &r) != nil {
		return
	}
	t := c.t
	t.do(func() {
		sub := r.ParentToolUseID != nil && *r.ParentToolUseID != "" // a subagent's events
		switch r.Type {
		case "system":
			switch r.Subtype {
			case "init":
				if r.SessionID != "" && r.SessionID != t.st.Session { // /clear started a new conversation
					t.st.Session = r.SessionID
					t.reset([]Msg{{ID: "clear-" + r.SessionID, Role: "system", Text: "Conversation cleared"}})
				}
				t.st.Model, t.st.Mode = r.Model, fromClaudeMode(r.PermissionMode)
				if r.SlashCommands != nil {
					t.st.Commands = r.SlashCommands
				}
			case "status":
				if !sub {
					t.st.Activity = "Working…"
				}
			case "thinking_tokens":
				if !sub {
					t.st.Activity = fmt.Sprintf("Thinking… (%d tokens)", r.EstimatedTokens)
				}
			case "compact_boundary":
				c.compacted = true
				t.add(Msg{ID: "compact-" + r.UUID, Role: "system", Text: "Context compacted"})
			}

		case "stream_event":
			if sub {
				t.st.Activity = "Agent working…"
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
				t.st.Activity = ""
				t.resetDraft()
			case ev.Type == "content_block_start" && ev.ContentBlock.Type == "tool_use":
				t.st.Activity = "Running " + ev.ContentBlock.Name + "…"
			case ev.Type == "content_block_start" && ev.ContentBlock.Type == "thinking":
				t.st.Activity = "Thinking…"
			case ev.Type == "content_block_delta" && ev.Delta.Type == "text_delta":
				t.delta(ev.Delta.Text)
			}

		case "assistant":
			if sub || r.hidden() {
				return
			}
			for _, m := range recMsgs(r.chatRec) {
				t.add(m)
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
					t.turnStart()
				}
				t.add(m)
			}

		case "control_request":
			c.onRequest(r.RequestID, r.Request)

		case "control_response": // the CLI echoes our answers; a prompt may already be gone
			t.closePrompt(r.Response.RequestID)

		case "result":
			u := t.st.Usage
			if u == nil {
				u = &Usage{}
			}
			u.InputTokens += r.Usage.InputTokens
			u.OutputTokens += r.Usage.OutputTokens
			u.CostUSD += r.TotalCostUSD
			t.st.Usage = u
			t.turnEnd()
		}
	})
}

// onRequest: hub lock held.
func (c *claudeRT) onRequest(id string, raw json.RawMessage) {
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
	cp := &claudePrompt{input: q.Input}
	p := &Prompt{ID: id, Tool: q.ToolName, priv: cp}
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
		p.Options = []Option{{Label: "Yes, and auto-accept edits"}, {Label: "Yes, and approve each edit"}, {Label: "No, keep planning"}}
		cp.decisions = []claudeDecision{
			{allow: true, perms: []map[string]string{{"type": "setMode", "mode": "acceptEdits", "destination": "session"}}},
			{allow: true},
			{allow: false},
		}
	default:
		p.Kind, p.Title = "permission", "Allow "+q.ToolName+"?"
		p.Body = promptBody(q.ToolName, q.Description, q.Input)
		p.Options = []Option{{Label: "Yes"}}
		cp.decisions = []claudeDecision{{allow: true}}
		if len(q.Suggestions) > 2 && string(q.Suggestions) != "null" {
			p.Options = append(p.Options, Option{Label: "Yes, and don't ask again", Desc: suggestionText(q.Suggestions)})
			cp.decisions = append(cp.decisions, claudeDecision{allow: true, perms: q.Suggestions})
		}
		p.Options = append(p.Options, Option{Label: "No"})
		cp.decisions = append(cp.decisions, claudeDecision{allow: false})
	}
	c.t.addPrompt(p)
}

func promptBody(tool, desc string, in map[string]any) string {
	var b strings.Builder
	if desc != "" {
		b.WriteString(desc + "\n")
	}
	str := func(k string) string { s, _ := in[k].(string); return s }
	switch {
	case str("command") != "":
		b.WriteString("$ " + clip(str("command"), 2000))
	case str("old_string") != "" || str("new_string") != "":
		fmt.Fprintf(&b, "%s\n- %s\n+ %s", str("file_path"), clip(str("old_string"), 800), clip(str("new_string"), 800))
	case str("file_path") != "":
		b.WriteString(str("file_path"))
		if c := str("content"); c != "" {
			b.WriteString("\n" + clip(c, 1200))
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

func (c *claudeRT) write(v any) error {
	b, _ := json.Marshal(v)
	c.inMu.Lock()
	defer c.inMu.Unlock()
	_, err := c.in.Write(append(b, '\n'))
	return err
}

// Send queues a user turn (claude queues it if a turn is running); slash commands are plain text.
func (c *claudeRT) Send(text string) error {
	return c.write(map[string]any{"type": "user", "message": map[string]any{"role": "user", "content": text}})
}

func (c *claudeRT) control(req map[string]any) error {
	return c.write(map[string]any{"type": "control_request", "request_id": "luther-" + randHex(6), "request": req})
}

func (c *claudeRT) Interrupt() error { return c.control(map[string]any{"subtype": "interrupt"}) }

func (c *claudeRT) SetMode(m string) error {
	return c.control(map[string]any{"subtype": "set_permission_mode", "mode": claudeModes[m]})
}

func (c *claudeRT) SetModel(m string) error {
	if m == "" {
		return errors.New("empty model")
	}
	return c.control(map[string]any{"subtype": "set_model", "model": m})
}

func (c *claudeRT) Answer(p *Prompt, a Answer) error {
	cp := p.priv.(*claudePrompt)
	resp := map[string]any{"behavior": "deny", "message": orDefault(a.Message, "The user declined this.")}
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
		resp["message"] = orDefault(a.Message, "The user wants to keep planning.")
	}
	return c.write(map[string]any{"type": "control_response", "response": map[string]any{
		"subtype": "success", "request_id": p.ID, "response": resp}})
}

// Stop closes stdin (claude exits after its current turn); kills after 10s.
func (c *claudeRT) Stop() {
	c.inMu.Lock()
	c.in.Close()
	c.inMu.Unlock()
	go func() {
		time.Sleep(10 * time.Second)
		c.t.mu.Lock()
		ended := c.t.ended
		c.t.mu.Unlock()
		if !ended {
			c.cmd.Process.Kill()
		}
	}()
}

// ---- history: Claude Code transcripts (~/.claude/projects/*/<sid>.jsonl) → messages ----

func claudeRoot() string { return filepath.Join(home, ".claude", "projects") }

func claudeHistory(sid string) []Msg {
	paths, _ := filepath.Glob(filepath.Join(claudeRoot(), "*", sid+".jsonl"))
	if len(paths) == 0 {
		return nil
	}
	msgs := readChat(paths[0])
	return msgs[max(0, len(msgs)-keepMsgs):]
}

var (
	cmdNameRe = regexp.MustCompile(`<command-name>(.*?)</command-name>`)
	cmdArgsRe = regexp.MustCompile(`(?s)<command-args>(.*?)</command-args>`)
	stdoutRe  = regexp.MustCompile(`(?s)<local-command-stdout>(.*?)</local-command-stdout>`)
)

type chatRec struct {
	Type        string `json:"type"`
	Subtype     string `json:"subtype"`
	UUID        string `json:"uuid"`
	IsMeta      bool   `json:"isMeta"`
	IsCompact   bool   `json:"isCompactSummary"`
	TransOnly   bool   `json:"isVisibleInTranscriptOnly"`
	IsSidechain bool   `json:"isSidechain"`
	Message     struct {
		Content json.RawMessage `json:"content"`
	} `json:"message"`
}

type block struct {
	Type  string         `json:"type"`
	Text  string         `json:"text"`
	Name  string         `json:"name"`
	Input map[string]any `json:"input"`
}

func (r chatRec) hidden() bool { return r.IsSidechain || r.IsMeta || r.IsCompact || r.TransOnly }

// readChat parses a transcript. System records are matched by parsed type and
// subtype, never by substring (tool output can quote them).
func readChat(path string) []Msg {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var msgs []Msg
	br := bufio.NewReaderSize(f, 1<<16)
	for n := 0; ; n++ {
		line, err := br.ReadBytes('\n')
		if err != nil {
			break // partial last line
		}
		if bytes.Contains(line, []byte(`"subtype":"compact_boundary"`)) {
			var r chatRec
			if json.Unmarshal(line, &r) == nil && r.Type == "system" && r.Subtype == "compact_boundary" {
				msgs = append(msgs, Msg{ID: fmt.Sprint("compact@", n), Role: "system", Text: "Context compacted"})
			}
			continue
		}
		if !bytes.Contains(line, []byte(`"type":"user"`)) && !bytes.Contains(line, []byte(`"type":"assistant"`)) {
			continue
		}
		var r chatRec
		if json.Unmarshal(line, &r) != nil || r.hidden() {
			continue
		}
		msgs = append(msgs, recMsgs(r)...)
	}
	return msgs
}

func recMsgs(r chatRec) []Msg {
	var text string
	if json.Unmarshal(r.Message.Content, &text) == nil {
		if r.Type != "user" {
			return nil
		}
		if m := cmdNameRe.FindStringSubmatch(text); m != nil {
			cmd := m[1]
			if a := cmdArgsRe.FindStringSubmatch(text); a != nil && strings.TrimSpace(a[1]) != "" {
				cmd += " " + strings.TrimSpace(a[1])
			}
			return []Msg{{ID: r.UUID, Role: "user", Text: cmd}}
		}
		if m := stdoutRe.FindStringSubmatch(text); m != nil {
			if s := strings.TrimSpace(m[1]); s != "" {
				return []Msg{{ID: r.UUID, Role: "system", Text: s}}
			}
			return nil
		}
		if strings.HasPrefix(strings.TrimSpace(text), "<") {
			return nil // caveats and other wrappers
		}
		return []Msg{{ID: r.UUID, Role: "user", Text: text}}
	}
	var blocks []block
	json.Unmarshal(r.Message.Content, &blocks)
	var out []Msg
	for i, b := range blocks {
		id := fmt.Sprintf("%s#%d", r.UUID, i)
		switch {
		case b.Type == "text" && strings.TrimSpace(b.Text) != "" && !strings.HasPrefix(b.Text, "<"):
			role := "assistant"
			if r.Type == "user" {
				role = "user"
			}
			out = append(out, Msg{ID: id, Role: role, Text: b.Text})
		case b.Type == "tool_use":
			out = append(out, Msg{ID: id, Role: "tool", Tool: b.Name, Text: toolSummary(b.Name, b.Input)})
		}
	}
	return out
}

func toolSummary(name string, in map[string]any) string {
	if name == "AskUserQuestion" {
		if qs, ok := in["questions"].([]any); ok && len(qs) > 0 {
			if q, ok := qs[0].(map[string]any); ok {
				return fmt.Sprint(q["question"])
			}
		}
	}
	for _, k := range []string{"description", "command", "file_path", "pattern", "url", "query", "prompt", "skill"} {
		if v, ok := in[k].(string); ok && v != "" {
			return clip(v, 300)
		}
	}
	return ""
}

// ---- slash commands ----

var claudeBuiltins = []Command{
	{"/clear", "Clear conversation history"}, {"/compact", "Compact conversation"},
	{"/context", "Show context usage"}, {"/cost", "Show token usage and cost"},
	{"/model", "Switch model"}, {"/effort", "Set reasoning effort"},
	{"/init", "Create a CLAUDE.md for this project"}, {"/review", "Review a pull request"},
	{"/memory", "Edit memory files"}, {"/status", "Show status"},
	{"/help", "Show help"}, {"/mcp", "Manage MCP servers"}, {"/agents", "Manage subagents"},
}

var descRe = regexp.MustCompile(`(?m)^description:\s*["']?(.*?)["']?\s*$`)

// claudeCommands: built-ins + custom commands (.claude/commands/**.md) + skills
// (.claude/skills/*/SKILL.md), from ~/.claude and <cwd>/.claude.
func claudeCommands(cwd string) []Command {
	out := append([]Command{}, claudeBuiltins...)
	desc := func(path string) string {
		b, _ := os.ReadFile(path)
		if m := descRe.FindSubmatch(b); m != nil {
			return clip(string(m[1]), 120)
		}
		return ""
	}
	for _, root := range []string{filepath.Join(home, ".claude"), filepath.Join(cwd, ".claude")} {
		cmds := filepath.Join(root, "commands")
		filepath.WalkDir(cmds, func(p string, d os.DirEntry, err error) error {
			if err == nil && !d.IsDir() && strings.HasSuffix(p, ".md") {
				rel, _ := filepath.Rel(cmds, strings.TrimSuffix(p, ".md"))
				out = append(out, Command{"/" + strings.ReplaceAll(rel, string(filepath.Separator), ":"), desc(p)})
			}
			return nil
		})
		skills, _ := filepath.Glob(filepath.Join(root, "skills", "*", "SKILL.md"))
		for _, p := range skills {
			out = append(out, Command{"/" + filepath.Base(filepath.Dir(p)), desc(p)})
		}
	}
	return out
}

// ---- one writer per session: Claude Code's process registry (~/.claude/sessions/<pid>.json) ----

type claudeProc struct {
	Pid int
	Sid string
}

func claudeProcs() []claudeProc {
	paths, _ := filepath.Glob(filepath.Join(home, ".claude", "sessions", "*.json"))
	var out []claudeProc
	for _, p := range paths {
		var rec struct {
			Pid       int    `json:"pid"`
			SessionID string `json:"sessionId"`
		}
		b, err := os.ReadFile(p)
		if err != nil || json.Unmarshal(b, &rec) != nil || rec.Pid <= 0 {
			continue
		}
		// Stale files outlive crashed processes; EPERM still means alive.
		if err := syscall.Kill(rec.Pid, 0); err != nil && err != syscall.EPERM {
			continue
		}
		out = append(out, claudeProc{Pid: rec.Pid, Sid: rec.SessionID})
	}
	return out
}

// ourPids: pids of Luther's own claude processes. Callers hold threads' lock.
func ourPidsLocked() map[int]bool {
	ours := map[int]bool{}
	for _, t := range threads.m {
		if c, ok := t.rt.(*claudeRT); ok {
			ours[c.cmd.Process.Pid] = true
		}
	}
	return ours
}

func claudeHeldOutside(sid string) bool {
	ours := ourPidsLocked()
	for _, p := range claudeProcs() {
		if p.Sid == sid && !ours[p.Pid] {
			return true
		}
	}
	return false
}

// claudeBusy: sessions held by a claude outside Luther.
func claudeBusy() map[string]bool {
	threads.Lock()
	ours := ourPidsLocked()
	threads.Unlock()
	busy := map[string]bool{}
	for _, p := range claudeProcs() {
		if !ours[p.Pid] {
			busy[p.Sid] = true
		}
	}
	return busy
}

// claudeTakeOver ends outside claude processes holding sid ("Move to Luther").
// SIGTERM lets claude exit cleanly (the transcript is on disk); SIGKILL after 8s.
func claudeTakeOver(sid string) error {
	var pids []int
	for _, p := range claudeProcs() {
		if p.Sid == sid {
			pids = append(pids, p.Pid)
		}
	}
	for _, pid := range pids {
		syscall.Kill(pid, syscall.SIGTERM)
	}
	for _, pid := range pids {
		deadline := time.Now().Add(8 * time.Second)
		for syscall.Kill(pid, 0) == nil {
			if time.Now().After(deadline) {
				syscall.Kill(pid, syscall.SIGKILL)
				time.Sleep(200 * time.Millisecond)
				break
			}
			time.Sleep(100 * time.Millisecond)
		}
		if syscall.Kill(pid, 0) == nil {
			return fmt.Errorf("could not stop claude (pid %d)", pid)
		}
	}
	return nil
}

// watchDups flags open Claude threads whose session a CLI outside Luther has
// also opened; both would write the transcript, so every client warns.
func watchDups() {
	for range time.Tick(5 * time.Second) {
		busy := claudeBusy()
		for _, t := range listThreads() {
			if _, ok := t.rt.(*claudeRT); !ok {
				continue
			}
			t.mu.Lock() // not t.do: that would refresh touched and keep idle threads alive
			t.st.Dup = busy[t.st.Session]
			t.syncState()
			t.mu.Unlock()
		}
	}
}

// logTail: a child's stderr into the server log, one line at a time.
type logTail struct {
	prefix string
	buf    []byte
}

func (l *logTail) Write(p []byte) (int, error) {
	l.buf = append(l.buf, p...)
	for {
		i := bytes.IndexByte(l.buf, '\n')
		if i < 0 {
			break
		}
		log.Print(l.prefix + clip(string(l.buf[:i]), 500))
		l.buf = l.buf[i+1:]
	}
	return len(p), nil
}

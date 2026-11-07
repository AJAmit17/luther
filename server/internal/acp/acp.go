// Package acp: agents that speak the Agent Client Protocol (JSON-RPC over
// stdio): OpenCode, Gemini CLI, Cursor. One shared process per agent hosts all
// of its open threads; session/update notifications carry a sessionId and are
// routed to that thread. Verified against OpenCode 1.18 (`opencode acp`):
// initialize → agentCapabilities {loadSession, promptCapabilities.image,
// sessionCapabilities.list|fork|resume}; session/new → {sessionId,
// configOptions [{id: model|mode, currentValue, options}]}; session/list →
// {sessions [{sessionId, cwd, title, updatedAt}]}; plugin log lines on stdout.
package acp

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/AJAmit17/luther/server/internal/env"
	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/rpc"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/AJAmit17/luther/server/internal/uploads"
	"github.com/AJAmit17/luther/server/internal/usage"
)

// Agent: how to start one ACP agent. Bins are tried in order.
type Agent struct {
	ID   protocol.Provider
	Name string
	Bins []string
	Args []string
}

var Agents = []Agent{
	{protocol.OpenCode, "OpenCode", []string{"opencode"}, []string{"acp"}},
	{protocol.Gemini, "Gemini CLI", []string{"gemini"}, []string{"--acp"}},
	{protocol.Cursor, "Cursor", []string{"cursor-agent", "agent"}, []string{"acp"}},
	{protocol.Devin, "Devin", []string{"devin"}, []string{"acp"}},
	{protocol.OMP, "Oh My Pi", []string{"omp"}, []string{"acp"}},
}

func Find(p protocol.Provider) (Agent, bool) {
	for _, a := range Agents {
		if a.ID == p {
			return a, true
		}
	}
	return Agent{}, false
}

// Bin: the first of Bins on PATH, or "".
func (a Agent) Bin() string {
	for _, b := range a.Bins {
		if p, err := exec.LookPath(b); err == nil {
			return p
		}
	}
	return ""
}

// Version: `<bin> --version`, and whether it ran.
func (a Agent) Version() (string, bool) {
	b := a.Bin()
	if b == "" {
		return "", false
	}
	out, err := exec.Command(b, "--version").Output()
	return text.OneLine(string(out)), err == nil
}

// ---- the shared process ----

type caps struct {
	LoadSession bool `json:"loadSession"`
	Prompt      struct {
		Image bool `json:"image"`
	} `json:"promptCapabilities"`
	Session struct {
		List  *struct{} `json:"list"`
		Fork  *struct{} `json:"fork"`
		Close *struct{} `json:"close"`
	} `json:"sessionCapabilities"`
}

type server struct {
	*rpc.Conn
	agent Agent
	cmd   *exec.Cmd
	caps  caps

	mu     sync.Mutex
	rts    map[string]*runtime // session id → runtime
	models []protocol.Model    // from the last session/new, for GET /models
	listed time.Time
	list   []protocol.Session
}

var procs = struct {
	sync.Mutex
	m map[protocol.Provider]*server
}{m: map[protocol.Provider]*server{}}

// srv: the agent's running process, starting (or restarting) it.
// ponytail: it stays up once started (listing sessions starts it too); stop it
// when idle if memory matters.
func srv(a Agent) (*server, error) {
	procs.Lock()
	defer procs.Unlock()
	if s := procs.m[a.ID]; s != nil && !s.Dead() {
		return s, nil
	}
	bin := a.Bin()
	if bin == "" {
		return nil, fmt.Errorf("%s is not installed (looked for %s)", a.Name, strings.Join(a.Bins, ", "))
	}
	cmd := exec.Command(bin, a.Args...)
	cmd.Dir = paths.Home
	cmd.Stderr = &env.LogTail{Prefix: string(a.ID) + ": "}
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start %s: %w", a.Name, err)
	}
	s := &server{Conn: rpc.New(a.Name, in, true), agent: a, cmd: cmd, rts: map[string]*runtime{}}
	go func() {
		s.Read(out, s.dispatch)
		cmd.Wait()
		s.mu.Lock()
		rts := s.rts
		s.rts = map[string]*runtime{}
		s.mu.Unlock()
		for _, rt := range rts {
			rt.t.End()
		}
	}()
	raw, err := s.Call("initialize", map[string]any{
		"protocolVersion":    1,
		"clientCapabilities": map[string]any{"fs": map[string]bool{"readTextFile": false, "writeTextFile": false}, "terminal": false},
		"clientInfo":         map[string]string{"name": "luther", "title": "Luther", "version": protocol.Version},
	})
	if err != nil {
		cmd.Process.Kill()
		return nil, fmt.Errorf("%s initialize: %w", a.Name, err)
	}
	var init struct {
		Caps caps `json:"agentCapabilities"`
	}
	json.Unmarshal(raw, &init)
	s.caps = init.Caps
	procs.m[a.ID] = s
	return s, nil
}

func (s *server) dispatch(m rpc.Msg) {
	var p struct {
		SessionID string `json:"sessionId"`
	}
	json.Unmarshal(m.Params, &p)
	s.mu.Lock()
	rt := s.rts[p.SessionID]
	s.mu.Unlock()
	switch {
	case m.ID != nil && rt != nil && m.Method == "session/request_permission":
		rt.onPermission(m.ID, m.Params)
	case m.ID != nil: // fs/*, terminal/* (we don't offer them), vendor extensions
		s.ReplyErr(m.ID, "unsupported by luther: "+m.Method)
	case rt != nil && m.Method == "session/update":
		rt.onUpdate(m.Params)
	}
}

// ---- past sessions ----

// Sessions: every installed agent's past sessions (agents that can list
// them), cached for 30 s since listing starts the agent.
func Sessions() []protocol.Session {
	var out []protocol.Session
	for _, a := range Agents {
		if a.Bin() == "" {
			continue
		}
		s, err := srv(a)
		if err != nil || s.caps.Session.List == nil {
			continue
		}
		out = append(out, s.sessions()...)
	}
	return out
}

func (s *server) sessions() []protocol.Session {
	s.mu.Lock()
	if time.Since(s.listed) < 30*time.Second {
		defer s.mu.Unlock()
		return s.list
	}
	s.mu.Unlock()
	var all []protocol.Session
	cursor := ""
	for page := 0; page < 10; page++ {
		params := map[string]any{}
		if cursor != "" {
			params["cursor"] = cursor
		}
		raw, err := s.Call("session/list", params)
		if err != nil {
			break
		}
		var r struct {
			Sessions []struct {
				SessionID string `json:"sessionId"`
				Cwd       string `json:"cwd"`
				Title     string `json:"title"`
				UpdatedAt string `json:"updatedAt"`
			} `json:"sessions"`
			Next string `json:"nextCursor"`
		}
		json.Unmarshal(raw, &r)
		for _, x := range r.Sessions {
			when, _ := time.Parse(time.RFC3339Nano, x.UpdatedAt)
			title := x.Title
			if strings.HasPrefix(title, "New session - ") {
				title = "" // OpenCode's placeholder
			}
			all = append(all, protocol.Session{Provider: s.agent.ID, ID: x.SessionID, Cwd: x.Cwd, Title: title, LastActive: when})
		}
		if cursor = r.Next; cursor == "" {
			break
		}
	}
	s.mu.Lock()
	s.list, s.listed = all, time.Now()
	s.mu.Unlock()
	return all
}

// Models: the agent's models, with its names for them. From its last new
// session; before any, from a session opened just to ask, in a scratch folder
// outside your home (so it never shows as a project).
func Models(p protocol.Provider) []protocol.Model {
	a, ok := Find(p)
	if !ok || a.Bin() == "" {
		return nil
	}
	s, err := srv(a)
	if err != nil {
		return nil
	}
	s.mu.Lock()
	ms := s.models
	s.mu.Unlock()
	if ms != nil {
		return ms
	}
	dir, err := os.MkdirTemp("", "luther-models-*") // fresh and private, as in claude.Models
	if err != nil {
		return nil
	}
	defer os.RemoveAll(dir)
	raw, err := s.CallWait("session/new", map[string]any{"cwd": dir, "mcpServers": []any{}}, 45*time.Second)
	if err != nil {
		log.Printf("%s models: %v", a.Name, err)
		return nil
	}
	var resp sessionResp
	json.Unmarshal(raw, &resp)
	ms = modelsOf(resp)
	s.mu.Lock()
	s.models = ms
	s.mu.Unlock()
	return ms
}

// modelsOf: a session's model choices (configOptions, grouped or flat; else
// the older models.availableModels), named as the agent names them.
func modelsOf(r sessionResp) []protocol.Model {
	var out []protocol.Model
	var walk func(group string, opts []choice)
	walk = func(group string, opts []choice) {
		for _, o := range opts {
			if o.Value != "" {
				m := protocol.Model{ID: o.Value, Name: text.OrDefault(o.Name, o.Value), Desc: o.Desc, Group: group}
				if i := strings.Index(o.Value, "/"); m.Group == "" && i > 0 {
					m.Group = o.Value[:i] // "openrouter/…", "github-copilot/…"
				}
				if m.Desc == m.ID {
					m.Desc = ""
				}
				out = append(out, m)
			}
			walk(text.OrDefault(o.Name, group), o.Options)
		}
	}
	for _, o := range r.Config {
		if o.Category == "model" {
			walk("", o.Options)
		}
	}
	if out == nil && r.Models != nil {
		for _, m := range r.Models.Available {
			out = append(out, protocol.Model{ID: m.ID, Name: text.OrDefault(m.Name, m.ID), Desc: m.Desc})
		}
	}
	// The session's effort and speed options hold for every model it lists.
	k := knobsOf(r.Config)
	for i := range out {
		out[i].Efforts, out[i].Effort, out[i].Fast = k.efforts, k.effort, k.fastID != ""
	}
	return out
}

// knobs: a session's reasoning-effort option ("thought_level") and its fast
// option (Devin's "speed": standard | fast), when it has them.
type knobs struct {
	effortID, effort string
	efforts          []string
	fastID, fast     string // fast: "on" | "off"
	fastOn, fastOff  string // the option's values for each
}

func knobsOf(cfg []option) knobs {
	var k knobs
	for _, o := range cfg {
		if o.Category == "thought_level" && k.effortID == "" {
			k.effortID, k.effort = o.ID, o.Current
			for _, x := range choices(o.Options) {
				k.efforts = append(k.efforts, x.Value)
			}
			continue
		}
		var on, off string
		for _, x := range choices(o.Options) {
			if x.Value == "fast" {
				on = x.Value
			} else if off == "" {
				off = x.Value
			}
		}
		if on != "" && off != "" && o.Category != "model" && k.fastID == "" {
			k.fastID, k.fastOn, k.fastOff = o.ID, on, off
			k.fast = map[bool]string{true: "on", false: "off"}[o.Current == on]
		}
	}
	return k
}

// ---- one open session ----

type option struct {
	ID       string   `json:"id"`
	Category string   `json:"category"`
	Current  string   `json:"currentValue"`
	Options  []choice `json:"options"`
}

type choice struct {
	Value   string   `json:"value"`
	Name    string   `json:"name"`
	Desc    string   `json:"description"`
	Options []choice `json:"options"`
}

func choices(options []choice) []choice {
	var out []choice
	for _, o := range options {
		if o.Value != "" {
			out = append(out, o)
		}
		out = append(out, choices(o.Options)...)
	}
	return out
}

type sessionResp struct {
	SessionID string   `json:"sessionId"`
	Config    []option `json:"configOptions"`
	Models    *struct {
		Available []struct {
			ID   string `json:"modelId"`
			Name string `json:"name"`
			Desc string `json:"description"`
		} `json:"availableModels"`
	} `json:"models"`
	Modes *struct {
		Current   string `json:"currentModeId"`
		Available []struct {
			ID string `json:"id"`
		} `json:"availableModes"`
	} `json:"modes"`
}

type runtime struct {
	t  *hub.Thread
	s  *server
	id string

	mu       sync.Mutex
	busy     bool
	stopped  bool
	queue    []string // sent while a turn runs (ACP can't steer)
	mode     string   // Luther's
	config   []option // the agent's selectable options (model, mode)
	agentDef string   // the agent's own mode to return to when leaving plan

	// hub lock: text being streamed, and replayed history while loading.
	replay    bool   // session/load is replaying history
	kind      string // "agent" | "user" | "": what buf holds
	buf       strings.Builder
	seq       int
	cost      float64
	costKnown bool
}

// Open starts, loads (resume) or forks a session.
func Open(a Agent, r protocol.OpenReq) (*hub.Thread, error) {
	s, err := srv(a)
	if err != nil {
		return nil, err
	}
	mode := text.OrDefault(r.Mode, protocol.ModeAsk)
	base := map[string]any{"cwd": r.Cwd, "mcpServers": []any{}}
	method := "session/new"
	switch {
	case r.Resume != "" && r.Fork:
		if s.caps.Session.Fork == nil {
			return nil, fmt.Errorf("%s can't fork sessions", a.Name)
		}
		method = "session/fork"
		base["sessionId"] = r.Resume
	case r.Resume != "":
		if !s.caps.LoadSession {
			return nil, fmt.Errorf("%s can't resume sessions", a.Name)
		}
		method = "session/load"
		base["sessionId"] = r.Resume
	}
	// A loading session replays its history as updates before the answer:
	// register first so they land in the thread.
	id := r.Resume
	var t *hub.Thread
	var rt *runtime
	if method == "session/load" {
		t, rt = s.newThread(id, r.Cwd, mode)
		rt.replay = true
	}
	raw, err := s.CallWait(method, base, 5*time.Minute)
	if err != nil {
		s.drop(id)
		return nil, err
	}
	var resp sessionResp
	json.Unmarshal(raw, &resp)
	if method != "session/load" {
		if resp.SessionID == "" {
			return nil, fmt.Errorf("%s %s: no session id", a.Name, method)
		}
		id = resp.SessionID
		t, rt = s.newThread(id, r.Cwd, mode)
	}
	t.Do(func(*protocol.State) {
		rt.flush()
		rt.replay = false
	})
	rt.configure(resp)
	if r.Model != "" {
		if err := rt.SetModel(r.Model); err != nil {
			t.Do(func(*protocol.State) { t.Fail(err.Error()) })
		}
	}
	if err := rt.applyMode(mode); err != nil {
		rt.Stop()
		return nil, err
	}
	return t, nil
}

func (s *server) newThread(id, cwd, mode string) (*hub.Thread, *runtime) {
	t := hub.New(id, protocol.State{Provider: s.agent.ID, Session: id, Cwd: cwd, Mode: mode})
	rt := &runtime{t: t, s: s, id: id, mode: mode}
	t.SetRuntime(rt)
	s.mu.Lock()
	s.rts[id] = rt
	s.mu.Unlock()
	return t, rt
}

func (s *server) drop(id string) {
	s.mu.Lock()
	delete(s.rts, id)
	s.mu.Unlock()
}

// configure: the session's model and mode options.
func (c *runtime) configure(r sessionResp) {
	models := modelsOf(r)
	model := ""
	c.mu.Lock()
	c.config = r.Config
	for _, o := range r.Config {
		switch o.Category {
		case "model":
			model = o.Current
		case "mode":
			if !strings.Contains(o.Current, "plan") {
				c.agentDef = o.Current
			}
		}
	}
	if r.Modes != nil && c.agentDef == "" && !strings.Contains(r.Modes.Current, "plan") {
		c.agentDef = r.Modes.Current
	}
	c.mu.Unlock()
	c.t.Do(func(st *protocol.State) {
		st.Model = model
		c.showKnobs(st)
	})
	if models != nil {
		c.s.mu.Lock()
		c.s.models = models
		c.s.mu.Unlock()
	}
}

// ---- updates ----

func (c *runtime) onUpdate(raw json.RawMessage) {
	var p struct {
		Update struct {
			Kind    string `json:"sessionUpdate"`
			Content struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
			ToolCallID string         `json:"toolCallId"`
			Title      string         `json:"title"`
			ToolKind   string         `json:"kind"`
			Status     string         `json:"status"`
			RawInput   map[string]any `json:"rawInput"`
			Entries    []struct {
				Content string `json:"content"`
				Status  string `json:"status"`
			} `json:"entries"`
			Commands []struct {
				Name string `json:"name"`
			} `json:"availableCommands"`
			ModeID string `json:"currentModeId"`
			Used   int64  `json:"used"`
			Cost   *struct {
				Amount   float64
				Currency string
			} `json:"cost"`
			Config []option `json:"configOptions"`
		} `json:"update"`
	}
	if json.Unmarshal(raw, &p) != nil {
		return
	}
	u := p.Update
	t := c.t
	t.Do(func(st *protocol.State) {
		switch u.Kind {
		case "agent_message_chunk", "user_message_chunk":
			if u.Content.Type != "text" {
				return
			}
			kind := "agent"
			if u.Kind == "user_message_chunk" {
				if !c.replay {
					return // live: Send already added it
				}
				kind = "user"
			}
			if c.kind != kind {
				c.flush()
				c.kind = kind
			}
			c.buf.WriteString(u.Content.Text)
			if kind == "agent" {
				st.Activity = ""
				t.Delta(u.Content.Text)
			}
		case "agent_thought_chunk":
			st.Activity = "Thinking…"
		case "tool_call":
			c.flush()
			title := text.OrDefault(u.Title, u.ToolKind)
			t.Add(protocol.Msg{ID: text.OrDefault(u.ToolCallID, c.nextID()), Role: "tool", Tool: toolName(u.ToolKind), Text: text.Clip(title, 300)})
			st.Activity = "Running " + text.Clip(title, 40) + "…"
		case "tool_call_update":
			if u.Status == "failed" {
				st.Activity = "A tool failed"
			}
		case "plan":
			st.Tasks = st.Tasks[:0:0]
			for _, e := range u.Entries {
				st.Tasks = append(st.Tasks, protocol.Task{Text: e.Content, Status: text.OrDefault(e.Status, "pending")})
			}
		case "available_commands_update":
			st.Commands = st.Commands[:0:0]
			for _, x := range u.Commands {
				st.Commands = append(st.Commands, x.Name)
			}
		case "current_mode_update":
			if strings.Contains(u.ModeID, "plan") {
				st.Mode = protocol.ModePlan
			}
		case "usage_update":
			st.ContextTokens = u.Used
			if u.Cost != nil && strings.EqualFold(u.Cost.Currency, "USD") {
				c.cost, c.costKnown = u.Cost.Amount, true
			}
		}
	})
	if u.Kind == "config_option_update" {
		c.configure(sessionResp{Config: u.Config})
	}
}

// flush commits streamed text as a message. Hub lock held.
func (c *runtime) flush() {
	if c.buf.Len() > 0 && strings.TrimSpace(c.buf.String()) != "" {
		role := "assistant"
		if c.kind == "user" {
			role = "user"
		}
		c.t.Add(protocol.Msg{ID: c.nextID(), Role: role, Text: c.buf.String()})
	}
	c.buf.Reset()
	c.kind = ""
}

func (c *runtime) nextID() string {
	c.seq++
	return fmt.Sprintf("%s#%d", c.id, c.seq)
}

func toolName(kind string) string {
	switch kind {
	case "read":
		return "Read"
	case "edit":
		return "Edit"
	case "delete":
		return "Delete"
	case "move":
		return "Move"
	case "search":
		return "Search"
	case "execute":
		return "Shell"
	case "fetch":
		return "Fetch"
	case "think":
		return "Think"
	}
	return "Tool"
}

// ---- permissions ----

type promptData struct {
	rpcID   json.RawMessage
	options []permOption
}

type permOption struct {
	ID   string `json:"optionId"`
	Name string `json:"name"`
	Kind string `json:"kind"` // allow_once | allow_always | reject_once | reject_always
}

func (c *runtime) onPermission(rpcID json.RawMessage, raw json.RawMessage) {
	var p struct {
		ToolCall struct {
			Title    string         `json:"title"`
			Kind     string         `json:"kind"`
			RawInput map[string]any `json:"rawInput"`
		} `json:"toolCall"`
		Options []permOption `json:"options"`
	}
	json.Unmarshal(raw, &p)
	c.mu.Lock()
	mode := c.mode
	c.mu.Unlock()
	edit := p.ToolCall.Kind == "edit" || p.ToolCall.Kind == "delete" || p.ToolCall.Kind == "move"
	if mode == protocol.ModeFull || (mode == protocol.ModeEdits && edit) {
		if o := pick(p.Options, "allow_once", "allow_always"); o != "" {
			c.s.Reply(rpcID, selected(o))
			return
		}
	}
	pr := &protocol.Prompt{ID: "acp-" + text.RandHex(6), Kind: "permission", Tool: toolName(p.ToolCall.Kind),
		Title: text.OrDefault(p.ToolCall.Title, "Allow this?"), Priv: &promptData{rpcID: rpcID, options: p.Options}}
	if len(p.ToolCall.RawInput) > 0 {
		b, _ := json.MarshalIndent(p.ToolCall.RawInput, "", "  ")
		pr.Body = text.Clip(string(b), 2000)
	}
	for _, o := range p.Options {
		pr.Options = append(pr.Options, protocol.Option{Label: o.Name})
	}
	c.t.Do(func(st *protocol.State) { c.t.AddPrompt(pr) })
}

func pick(opts []permOption, kinds ...string) string {
	for _, k := range kinds {
		for _, o := range opts {
			if o.Kind == k {
				return o.ID
			}
		}
	}
	return ""
}

func selected(id string) map[string]any {
	if id == "" {
		return map[string]any{"outcome": map[string]any{"outcome": "cancelled"}}
	}
	return map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": id}}
}

func (c *runtime) Answer(p *protocol.Prompt, a protocol.Answer) error {
	cp := p.Priv.(*promptData)
	id := ""
	if a.Choice >= 0 && a.Choice < len(cp.options) {
		id = cp.options[a.Choice].ID
	} else {
		id = pick(cp.options, "reject_once", "reject_always")
	}
	if err := c.s.Reply(cp.rpcID, selected(id)); err != nil {
		return err
	}
	if a.Choice < 0 && strings.TrimSpace(a.Message) != "" {
		return c.Send(a.Message, nil) // runs after this turn
	}
	return nil
}

// ---- turns ----

// content: text, images inline (when the agent takes them), other files as links.
func (c *runtime) content(msg string, files []string) []map[string]any {
	var out []map[string]any
	if strings.TrimSpace(msg) != "" {
		out = append(out, map[string]any{"type": "text", "text": msg})
	}
	for _, f := range files {
		if uploads.IsImage(f) && c.s.caps.Prompt.Image {
			if b, err := os.ReadFile(f); err == nil {
				out = append(out, map[string]any{"type": "image", "mimeType": uploads.MediaType(f), "data": base64.StdEncoding.EncodeToString(b)})
				continue
			}
		}
		out = append(out, map[string]any{"type": "resource_link", "uri": "file://" + f, "name": f[strings.LastIndex(f, "/")+1:]})
	}
	return out
}

// Send runs a turn; while one runs, the message waits for it to end.
func (c *runtime) Send(msg string, files []string) error {
	c.mu.Lock()
	if c.stopped {
		c.mu.Unlock()
		return errors.New("session stopped")
	}
	if c.busy {
		if len(files) > 0 {
			c.mu.Unlock()
			return errors.New("wait for the turn to end to attach files")
		}
		c.queue = append(c.queue, msg)
		c.mu.Unlock()
		c.t.Do(func(st *protocol.State) { st.Activity = "Working… (your message is next)" })
		return nil
	}
	c.busy = true
	c.mu.Unlock()
	c.t.Do(func(st *protocol.State) {
		c.flush()
		label := msg
		if len(files) > 0 {
			label = strings.TrimSpace(fmt.Sprintf("%s\n(attachments: %d)", label, len(files)))
		}
		c.t.Add(protocol.Msg{ID: c.nextID(), Role: "user", Text: label})
		c.t.TurnStart()
	})
	go c.run(c.content(msg, files))
	return nil
}

func (c *runtime) run(prompt []map[string]any) {
	var costBefore float64
	c.t.Do(func(*protocol.State) { costBefore = c.cost })
	raw, err := c.s.CallWait("session/prompt", map[string]any{"sessionId": c.id, "prompt": prompt}, 0)
	var r struct {
		StopReason string `json:"stopReason"`
		Usage      *struct {
			Input  int64 `json:"inputTokens"`
			Output int64 `json:"outputTokens"`
			Read   int64 `json:"cachedReadTokens"`
			Write  int64 `json:"cachedWriteTokens"`
		} `json:"usage"`
	}
	json.Unmarshal(raw, &r)
	var reported *protocol.Usage
	model := ""
	c.t.Do(func(st *protocol.State) {
		c.flush()
		if r.Usage != nil || (c.costKnown && c.cost > costBefore) {
			u := protocol.Usage{CostUSD: max(0, c.cost-costBefore), CostReported: c.costKnown}
			if r.Usage != nil {
				u.InputTokens, u.OutputTokens = max(0, r.Usage.Input), max(0, r.Usage.Output)
				u.CacheReadTokens, u.CacheWriteTokens = max(0, r.Usage.Read), max(0, r.Usage.Write)
			}
			reported = &u
			model = st.Model
			total := protocol.Usage{}
			if st.Usage != nil {
				total = *st.Usage
			}
			total.InputTokens += u.InputTokens
			total.OutputTokens += u.OutputTokens
			total.CacheReadTokens += u.CacheReadTokens
			total.CacheWriteTokens += u.CacheWriteTokens
			total.CostUSD += u.CostUSD
			total.CostReported = total.CostReported || u.CostReported
			st.Usage = &total
		}
		switch {
		case err != nil:
			c.t.Fail(err.Error())
		case r.StopReason == "cancelled":
			c.t.Add(protocol.Msg{ID: c.nextID(), Role: "system", Text: "Interrupted"})
		case r.StopReason == "refusal":
			c.t.Fail("The agent refused this request.")
		case r.StopReason == "max_tokens" || r.StopReason == "max_turn_requests":
			c.t.Add(protocol.Msg{ID: c.nextID(), Role: "system", Text: "Stopped: " + strings.ReplaceAll(r.StopReason, "_", " ")})
		}
		c.t.TurnEnd()
	})
	if reported != nil {
		id := string(c.s.agent.ID) + "/" + c.id + "/" + text.RandHex(12)
		if err := usage.Record(id, c.s.agent.ID, model, time.Now(), *reported); err != nil {
			log.Printf("save %s token usage: %v", c.s.agent.Name, err)
		}
	}
	c.mu.Lock()
	c.busy = false
	next := ""
	if len(c.queue) > 0 {
		next = strings.Join(c.queue, "\n\n")
		c.queue = nil
	}
	c.mu.Unlock()
	if next != "" {
		c.Send(next, nil)
	}
}

func (c *runtime) Interrupt() error {
	c.mu.Lock()
	busy := c.busy
	c.queue = nil
	c.mu.Unlock()
	if !busy {
		return errors.New("nothing is running")
	}
	// Open permission asks must be answered "cancelled" (ACP).
	c.t.Do(func(st *protocol.State) {
		c.t.ClosePromptWhere(func(p *protocol.Prompt) bool {
			if cp, ok := p.Priv.(*promptData); ok {
				c.s.Reply(cp.rpcID, selected(""))
			}
			return true
		})
	})
	return c.s.Notify("session/cancel", map[string]any{"sessionId": c.id})
}

// SetMode: Luther's modes are enforced here (auto-approving in edits/full);
// plan also switches the agent to its own plan mode when it has one.
func (c *runtime) SetMode(m string) error {
	if err := c.applyMode(m); err != nil {
		return err
	}
	c.mu.Lock()
	c.mode = m
	c.mu.Unlock()
	c.t.Do(func(st *protocol.State) { st.Mode = m })
	return nil
}

func (c *runtime) applyMode(m string) error {
	c.mu.Lock()
	cfg, def := c.config, c.agentDef
	c.mu.Unlock()
	for _, o := range cfg {
		if o.Category != "mode" {
			continue
		}
		want := def
		if c.s.agent.ID == protocol.Devin {
			want = map[string]string{protocol.ModeAsk: "ask", protocol.ModeEdits: "accept-edits", protocol.ModePlan: "plan", protocol.ModeFull: "bypass"}[m]
		}
		if m == protocol.ModePlan {
			for _, x := range choices(o.Options) {
				if strings.Contains(x.Value, "plan") {
					want = x.Value
				}
			}
		}
		if want == "" || want == o.Current {
			return nil
		}
		return c.setOption(o.ID, want)
	}
	return nil
}

func (c *runtime) SetModel(m string) error {
	if m == "" {
		return errors.New("empty model")
	}
	c.mu.Lock()
	cfg := c.config
	c.mu.Unlock()
	for _, o := range cfg {
		if o.Category == "model" {
			if err := c.setOption(o.ID, m); err != nil {
				return err
			}
			c.t.Do(func(st *protocol.State) { st.Model = m })
			return nil
		}
	}
	return fmt.Errorf("%s doesn't offer a model choice here", c.s.agent.Name)
}

// showKnobs: effort and fast mode into the state. Hub lock held.
func (c *runtime) showKnobs(st *protocol.State) {
	c.mu.Lock()
	k := knobsOf(c.config)
	c.mu.Unlock()
	st.Effort, st.Efforts, st.Fast = k.effort, k.efforts, k.fast
}

func (c *runtime) SetEffort(e string) error {
	c.mu.Lock()
	k := knobsOf(c.config)
	c.mu.Unlock()
	if k.effortID == "" {
		return fmt.Errorf("%s doesn't offer an effort choice here", c.s.agent.Name)
	}
	if err := c.setOption(k.effortID, e); err != nil {
		return err
	}
	c.t.Do(c.showKnobs)
	return nil
}

func (c *runtime) SetFast(on bool) error {
	c.mu.Lock()
	k := knobsOf(c.config)
	c.mu.Unlock()
	if k.fastID == "" {
		return fmt.Errorf("%s doesn't offer a fast mode here", c.s.agent.Name)
	}
	v := k.fastOff
	if on {
		v = k.fastOn
	}
	if err := c.setOption(k.fastID, v); err != nil {
		return err
	}
	c.t.Do(c.showKnobs)
	return nil
}

func (c *runtime) setOption(id, value string) error {
	raw, err := c.s.Call("session/set_config_option", map[string]any{"sessionId": c.id, "configId": id, "value": value})
	if err != nil {
		return err
	}
	var r struct {
		Config []option `json:"configOptions"`
	}
	if json.Unmarshal(raw, &r) == nil && r.Config != nil {
		c.mu.Lock()
		c.config = r.Config
		c.mu.Unlock()
	} else {
		c.mu.Lock()
		for i := range c.config {
			if c.config[i].ID == id {
				c.config[i].Current = value
			}
		}
		c.mu.Unlock()
	}
	return nil
}

// Stop releases the session; the agent keeps its history.
func (c *runtime) Stop() {
	c.mu.Lock()
	busy := c.busy
	c.stopped = true
	c.queue = nil
	c.mu.Unlock()
	if busy {
		c.s.Notify("session/cancel", map[string]any{"sessionId": c.id})
	}
	if c.s.caps.Session.Close != nil {
		go c.s.CallWait("session/close", map[string]any{"sessionId": c.id}, 5*time.Second)
	}
	c.s.drop(c.id)
	c.t.End()
}

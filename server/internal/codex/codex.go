// Package codex: the Codex adapter. One shared `codex app-server` process
// (JSON-RPC over stdio) hosts every open Codex thread.
package codex

import (
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"

	"github.com/AJAmit17/luther/server/internal/env"
	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/rpc"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/AJAmit17/luther/server/internal/uploads"
)

// Codex runtime: one shared `codex app-server` process (JSON-RPC over stdio)
// hosts every open Codex thread; notifications and server requests carry a
// threadId and are routed to that thread's runtime. Verified live against
// codex-cli 0.165.0:
//   - initialize, then the `initialized` notification;
//   - turn/start answers at once; then turn/started, item/started|completed,
//     item/agentMessage/delta, …, turn/completed;
//   - approvals are server→client requests (item/commandExecution|fileChange/requestApproval);
//     a fileChange approval carries no diff — it arrived earlier in item/started;
//   - thread/list {cwd} and thread/resume (turns included) replay history.

var Bin = "codex"

// Codex has no plan mode: plan maps to read-only with on-request approvals.
var policies = map[string]struct{ approval, sandbox, sandboxType string }{
	protocol.ModeAsk:   {"untrusted", "workspace-write", "workspaceWrite"},
	protocol.ModeEdits: {"on-request", "workspace-write", "workspaceWrite"},
	protocol.ModePlan:  {"on-request", "read-only", "readOnly"},
	protocol.ModeFull:  {"never", "danger-full-access", "dangerFullAccess"},
}

type server struct {
	*rpc.Conn
	cmd *exec.Cmd

	mu  sync.Mutex
	rts map[string]*runtime // codex thread id → runtime
}

var proc struct {
	sync.Mutex
	s *server
}

// srv returns the running app-server, starting (or restarting) it.
func srv() (*server, error) {
	proc.Lock()
	defer proc.Unlock()
	if s := proc.s; s != nil && !s.Dead() {
		return s, nil
	}
	cmd := exec.Command(Bin, "app-server")
	cmd.Dir = paths.Home
	cmd.Stderr = &env.LogTail{Prefix: "codex: "}
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start codex app-server: %w", err)
	}
	s := &server{Conn: rpc.New("codex", in, false), cmd: cmd, rts: map[string]*runtime{}}
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
	if _, err := s.Call("initialize", map[string]any{"clientInfo": map[string]string{"name": "luther", "title": "Luther", "version": protocol.Version}}); err != nil {
		cmd.Process.Kill()
		return nil, fmt.Errorf("codex initialize: %w", err)
	}
	s.Notify("initialized", nil)
	proc.s = s
	return s, nil
}

func (s *server) dispatch(m rpc.Msg) {
	if m.Method == "account/rateLimits/updated" {
		saveLimits(m.Params)
		return
	}
	var p struct {
		ThreadID string `json:"threadId"`
	}
	json.Unmarshal(m.Params, &p)
	s.mu.Lock()
	rt := s.rts[p.ThreadID]
	s.mu.Unlock()
	switch {
	case m.ID != nil && rt != nil:
		rt.onRequest(m.ID, m.Method, m.Params)
	case m.ID != nil: // a request we can't route: never leave codex blocked
		s.ReplyErr(m.ID, "unsupported by luther: "+m.Method)
	case rt != nil:
		rt.onNotify(m.Method, m.Params)
	}
}

// ---- one open Codex thread ----

type runtime struct {
	t  *hub.Thread
	s  *server
	id string // codex thread id

	mu     sync.Mutex
	turn   string // active turn id
	mode   string
	model  string
	effort string
	items  map[string]map[string]any // in-flight items by id (approval bodies)
}

type promptData struct {
	rpcID  json.RawMessage
	method string
}

type threadResp struct {
	Model  string    `json:"model"`
	Effort string    `json:"reasoningEffort"`
	Thread threadRec `json:"thread"`
}

type threadRec struct {
	ID      string `json:"id"`
	Cwd     string `json:"cwd"`
	Name    string `json:"name"`
	Preview string `json:"preview"`
	Updated int64  `json:"updatedAt"` // seconds
	Envs    []struct {
		Cwd string `json:"cwd"`
	} `json:"environments"`
	Turns []struct {
		Items []map[string]any `json:"items"`
	} `json:"turns"`
}

// Open starts, resumes or forks a Codex thread. RPCs can take seconds
// (MCP servers start), so callers must not hold the threads lock.
func Open(r protocol.OpenReq) (*hub.Thread, error) {
	s, err := srv()
	if err != nil {
		return nil, err
	}
	mode := text.OrDefault(r.Mode, protocol.ModeAsk)
	pol := policies[mode]
	params := map[string]any{"cwd": r.Cwd, "approvalPolicy": pol.approval, "sandbox": pol.sandbox}
	if r.Model != "" {
		params["model"] = r.Model
	}
	if r.Tools != nil { // per thread: the shared app-server starts it for this thread only
		params["config"] = map[string]any{"mcp_servers.luther": map[string]any{
			"command": r.Tools.Command, "args": r.Tools.Args, "env": r.Tools.Env,
			"default_tools_approval_mode": "approve", // Luther's own tools never ask
			"tool_timeout_sec":            1860,      // wait_for_thread may wait 30 minutes
		}}
	}
	method := "thread/start"
	if r.Resume != "" {
		params["threadId"] = r.Resume
		method = "thread/resume"
		if r.Fork {
			method = "thread/fork"
		}
	}
	raw, err := s.Call(method, params)
	if err != nil {
		return nil, err
	}
	var resp threadResp
	if err := json.Unmarshal(raw, &resp); err != nil || resp.Thread.ID == "" {
		return nil, fmt.Errorf("codex %s: unexpected reply", method)
	}
	id := resp.Thread.ID
	cwd := resp.Thread.Cwd
	if cwd == "" && len(resp.Thread.Envs) > 0 {
		cwd = resp.Thread.Envs[0].Cwd
	}
	t := hub.New(id, protocol.State{Provider: protocol.Codex, Session: id, Cwd: text.OrDefault(cwd, r.Cwd), Mode: mode, Model: resp.Model, Effort: resp.Effort})
	rt := &runtime{t: t, s: s, id: id, mode: mode, model: r.Model, items: map[string]map[string]any{}}
	t.SetRuntime(rt)
	var hist []protocol.Msg
	for _, turn := range resp.Thread.Turns {
		for _, it := range turn.Items {
			if m, ok := toMsg(it); ok {
				hist = append(hist, m)
			}
		}
	}
	t.SetHistory(hist)
	s.mu.Lock()
	s.rts[id] = rt
	s.mu.Unlock()
	return t, nil
}

func (c *runtime) onNotify(method string, raw json.RawMessage) {
	var p struct {
		TurnID string         `json:"turnId"`
		Turn   map[string]any `json:"turn"`
		Item   map[string]any `json:"item"`
		Delta  string         `json:"delta"`
		Error  struct {
			Message string `json:"message"`
		} `json:"error"`
		WillRetry  bool `json:"willRetry"`
		RequestID  json.RawMessage
		TokenUsage struct {
			Total struct {
				InputTokens       int64 `json:"inputTokens"`
				OutputTokens      int64 `json:"outputTokens"`
				CachedInputTokens int64 `json:"cachedInputTokens"`
			} `json:"total"`
		} `json:"tokenUsage"`
	}
	json.Unmarshal(raw, &p)
	t := c.t
	switch method {
	case "turn/started":
		c.mu.Lock()
		c.turn, _ = p.Turn["id"].(string)
		c.mu.Unlock()
		t.Do(func(*protocol.State) { t.TurnStart() })
	case "item/started":
		id, _ := p.Item["id"].(string)
		c.mu.Lock()
		c.items[id] = p.Item
		c.mu.Unlock()
		t.Do(func(st *protocol.State) {
			switch p.Item["type"] {
			case "agentMessage":
				st.Activity = ""
				t.ResetDraft()
			case "reasoning":
				st.Activity = "Thinking…"
			case "commandExecution":
				st.Activity = "Running " + text.Clip(str(p.Item, "command"), 40) + "…"
			case "fileChange":
				st.Activity = "Editing files…"
			case "mcpToolCall", "dynamicToolCall":
				st.Activity = "Calling " + str(p.Item, "tool") + "…"
			case "webSearch":
				st.Activity = "Searching the web…"
			case "collabAgentToolCall":
				st.Activity = "Subagent: " + text.OrDefault(text.Clip(text.OneLine(str(p.Item, "prompt")), 40), str(p.Item, "tool")) + "…"
			}
		})
	case "item/agentMessage/delta":
		t.Do(func(st *protocol.State) { t.Delta(p.Delta) })
	case "item/completed":
		id, _ := p.Item["id"].(string)
		c.mu.Lock()
		delete(c.items, id)
		c.mu.Unlock()
		if m, ok := toMsg(p.Item); ok {
			t.Do(func(st *protocol.State) { t.Add(m) })
		}
	case "turn/plan/updated":
		var pl struct {
			Plan []struct{ Step, Status string } `json:"plan"`
		}
		json.Unmarshal(raw, &pl)
		t.Do(func(st *protocol.State) {
			st.Tasks = st.Tasks[:0:0]
			for _, k := range pl.Plan {
				status := map[string]string{"inProgress": "in_progress", "in_progress": "in_progress", "completed": "completed"}[k.Status]
				st.Tasks = append(st.Tasks, protocol.Task{Text: k.Step, Status: text.OrDefault(status, "pending")})
			}
		})
	case "thread/tokenUsage/updated":
		t.Do(func(st *protocol.State) {
			st.Usage = &protocol.Usage{InputTokens: max(0, p.TokenUsage.Total.InputTokens-p.TokenUsage.Total.CachedInputTokens), OutputTokens: p.TokenUsage.Total.OutputTokens, CacheReadTokens: p.TokenUsage.Total.CachedInputTokens}
		})
	case "serverRequest/resolved": // answered elsewhere or auto-resolved
		t.Do(func(st *protocol.State) {
			t.ClosePromptWhere(func(pr *protocol.Prompt) bool {
				cp, ok := pr.Priv.(*promptData)
				return ok && string(cp.rpcID) == string(p.RequestID)
			})
		})
	case "error":
		if !p.WillRetry && p.Error.Message != "" {
			t.Do(func(st *protocol.State) { t.Fail(p.Error.Message) })
		}
	case "turn/completed":
		c.mu.Lock()
		c.turn = ""
		c.mu.Unlock()
		t.Do(func(st *protocol.State) {
			switch p.Turn["status"] {
			case "failed":
				if e, ok := p.Turn["error"].(map[string]any); ok {
					t.Fail(fmt.Sprint(e["message"]))
				}
			case "interrupted":
				t.Add(protocol.Msg{ID: "int-" + text.RandHex(4), Role: "system", Text: "Interrupted"})
			}
			t.TurnEnd()
		})
	}
}

func (c *runtime) onRequest(rpcID json.RawMessage, method string, raw json.RawMessage) {
	var p struct {
		ItemID    string `json:"itemId"`
		Command   string `json:"command"`
		Cwd       string `json:"cwd"`
		Reason    string `json:"reason"`
		Questions []struct {
			ID       string `json:"id"`
			Header   string `json:"header"`
			Question string `json:"question"`
			Options  []struct {
				Label       string `json:"label"`
				Description string `json:"description"`
			} `json:"options"`
		} `json:"questions"`
	}
	json.Unmarshal(raw, &p)
	pr := &protocol.Prompt{ID: "cx-" + text.RandHex(6), Priv: &promptData{rpcID: rpcID, method: method}}
	approve := []protocol.Option{{Label: "Yes"}, {Label: "Yes, and don't ask again this session"}, {Label: "No"}}
	switch method {
	case "item/commandExecution/requestApproval":
		pr.Kind, pr.Tool, pr.Title, pr.Options = "permission", "Shell", "Run this command?", approve
		pr.Body = strings.TrimSpace(text.OrDefault(p.Reason, "") + "\n$ " + text.Clip(p.Command, 2000))
	case "item/fileChange/requestApproval":
		pr.Kind, pr.Tool, pr.Title, pr.Options = "permission", "Edit", "Apply these changes?", approve
		c.mu.Lock()
		item := c.items[p.ItemID]
		c.mu.Unlock()
		pr.Body = strings.TrimSpace(text.OrDefault(p.Reason, "") + "\n" + fileChangeText(item, true))
	case "item/tool/requestUserInput":
		pr.Kind, pr.Tool, pr.Title = "question", "Question", "Codex has a question"
		for _, q := range p.Questions {
			qq := protocol.Question{ID: q.ID, Question: q.Question, Header: q.Header}
			for _, o := range q.Options {
				qq.Options = append(qq.Options, protocol.Option{Label: o.Label, Desc: o.Description})
			}
			pr.Questions = append(pr.Questions, qq)
		}
	case "mcpServer/elicitation/request":
		c.s.Reply(rpcID, map[string]any{"action": "decline"}) // ponytail: MCP forms aren't rendered on the phone yet
		return
	case "item/permissions/requestApproval":
		pr.Kind, pr.Tool, pr.Title = "permission", "Permissions", "Allow extra permissions?"
		pr.Body = text.OrDefault(p.Reason, "Codex asks for permissions beyond its sandbox.")
		pr.Options = []protocol.Option{{Label: "Yes, for this turn"}, {Label: "No"}}
		pr.Priv.(*promptData).method = method + "|" + string(raw)
	default:
		c.s.ReplyErr(rpcID, "unsupported by luther: "+method)
		return
	}
	c.t.Do(func(st *protocol.State) { c.t.AddPrompt(pr) })
}

func (c *runtime) Answer(p *protocol.Prompt, a protocol.Answer) error {
	cp := p.Priv.(*promptData)
	method, rawParams, _ := strings.Cut(cp.method, "|")
	switch method {
	case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
		decision := "decline"
		switch a.Choice {
		case 0:
			decision = "accept"
		case 1:
			decision = "acceptForSession"
		}
		if err := c.s.Reply(cp.rpcID, map[string]any{"decision": decision}); err != nil {
			return err
		}
		if decision == "decline" && strings.TrimSpace(a.Message) != "" {
			return c.Send(a.Message, nil) // "no, do this instead" steers the running turn
		}
		return nil
	case "item/tool/requestUserInput":
		ans := map[string]any{}
		for qid, labels := range a.Answers {
			ans[qid] = map[string]any{"answers": labels}
		}
		return c.s.Reply(cp.rpcID, map[string]any{"answers": ans})
	case "item/permissions/requestApproval":
		granted := map[string]any{}
		if a.Choice == 0 {
			var req struct {
				Permissions map[string]any `json:"permissions"`
			}
			json.Unmarshal([]byte(rawParams), &req)
			granted = req.Permissions
		}
		return c.s.Reply(cp.rpcID, map[string]any{"permissions": granted, "scope": "turn"})
	}
	return nil
}

// userInput: images as localImage inputs, other files named in the text.
func userInput(msg string, files []string) []map[string]any {
	var in []map[string]any
	var other []string
	for _, f := range files {
		if uploads.IsImage(f) {
			in = append(in, map[string]any{"type": "localImage", "path": f})
		} else {
			other = append(other, f)
		}
	}
	if len(other) > 0 {
		msg += "\n\nAttached files: " + strings.Join(other, ", ")
	}
	return append(in, map[string]any{"type": "text", "text": text.OrDefault(msg, "(see attachment)")})
}

// Send starts a turn, or steers the running one.
func (c *runtime) Send(msg string, files []string) error {
	c.mu.Lock()
	turn, mode, model, effort := c.turn, c.mode, c.model, c.effort
	c.mu.Unlock()
	if turn != "" {
		_, err := c.s.Call("turn/steer", map[string]any{"threadId": c.id, "expectedTurnId": turn, "input": userInput(msg, files)})
		return err
	}
	pol := policies[mode]
	params := map[string]any{"threadId": c.id, "input": userInput(msg, files), "approvalPolicy": pol.approval,
		"sandboxPolicy": map[string]any{"type": pol.sandboxType}}
	if model != "" {
		params["model"] = model
	}
	if effort != "" {
		params["effort"] = effort
	}
	_, err := c.s.Call("turn/start", params)
	return err
}

func (c *runtime) Interrupt() error {
	c.mu.Lock()
	turn := c.turn
	c.mu.Unlock()
	if turn == "" {
		return errors.New("nothing is running")
	}
	_, err := c.s.Call("turn/interrupt", map[string]any{"threadId": c.id, "turnId": turn})
	return err
}

// SetMode / SetModel apply from the next turn (Codex takes them per turn/start).
func (c *runtime) SetMode(m string) error {
	c.mu.Lock()
	c.mode = m
	c.mu.Unlock()
	c.t.Do(func(st *protocol.State) { st.Mode = m })
	return nil
}

func (c *runtime) SetModel(m string) error {
	if m == "" {
		return errors.New("empty model")
	}
	c.mu.Lock()
	c.model = m
	c.mu.Unlock()
	c.t.Do(func(st *protocol.State) { st.Model = m })
	return nil
}

// SetEffort applies from the next turn, like the model.
func (c *runtime) SetEffort(e string) error {
	if e == "" {
		return errors.New("empty effort")
	}
	c.mu.Lock()
	c.effort = e
	c.mu.Unlock()
	c.t.Do(func(st *protocol.State) { st.Effort = e })
	return nil
}

func (c *runtime) SetFast(bool) error { return errors.New("Codex has no fast mode here") }

// Compact: the app-server's own compaction of this thread.
func (c *runtime) Compact() error {
	_, err := c.s.Call("thread/compact/start", map[string]any{"threadId": c.id})
	return err
}

// Stop unloads the thread from the shared app-server; its history stays in Codex's store.
func (c *runtime) Stop() {
	c.s.Call("thread/unsubscribe", map[string]any{"threadId": c.id})
	c.s.mu.Lock()
	delete(c.s.rts, c.id)
	c.s.mu.Unlock()
	c.t.End()
}

// Running: whether the shared app-server is up, and how many threads it hosts.
func Running() (bool, int) {
	proc.Lock()
	s := proc.s
	proc.Unlock()
	if s == nil || s.Dead() {
		return false, 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return true, len(s.rts)
}

// Restart stops the app-server; its threads end (reopening resumes them) and
// the next request starts a fresh one.
func Restart() {
	proc.Lock()
	s := proc.s
	proc.s = nil
	proc.Unlock()
	if s != nil && s.cmd.Process != nil {
		s.cmd.Process.Kill()
	}
}

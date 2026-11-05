package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
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

var codexBin = "codex"

// Codex has no plan mode: plan maps to read-only with on-request approvals.
var codexPolicies = map[string]struct{ approval, sandbox, sandboxType string }{
	ModeAsk:   {"untrusted", "workspace-write", "workspaceWrite"},
	ModeEdits: {"on-request", "workspace-write", "workspaceWrite"},
	ModePlan:  {"on-request", "read-only", "readOnly"},
	ModeFull:  {"never", "danger-full-access", "dangerFullAccess"},
}

type rpcErr struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcMsg struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *rpcErr         `json:"error,omitempty"`
}

type codexServer struct {
	cmd  *exec.Cmd
	inMu sync.Mutex
	in   io.WriteCloser

	mu      sync.Mutex
	next    int64
	pending map[string]chan rpcMsg
	rts     map[string]*codexRT // codex thread id → runtime
	dead    bool
}

var codexProc struct {
	sync.Mutex
	s *codexServer
}

// codexSrv returns the running app-server, starting (or restarting) it.
func codexSrv() (*codexServer, error) {
	codexProc.Lock()
	defer codexProc.Unlock()
	if s := codexProc.s; s != nil && !s.isDead() {
		return s, nil
	}
	cmd := exec.Command(codexBin, "app-server")
	cmd.Dir = home
	cmd.Stderr = &logTail{prefix: "codex: "}
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
	s := &codexServer{cmd: cmd, in: in, pending: map[string]chan rpcMsg{}, rts: map[string]*codexRT{}}
	go s.read(out)
	if _, err := s.call("initialize", map[string]any{"clientInfo": map[string]string{"name": "luther", "title": "Luther", "version": version}}); err != nil {
		cmd.Process.Kill()
		return nil, fmt.Errorf("codex initialize: %w", err)
	}
	s.send(map[string]any{"method": "initialized"})
	codexProc.s = s
	return s, nil
}

func (s *codexServer) isDead() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dead
}

func (s *codexServer) send(v any) error {
	b, _ := json.Marshal(v)
	s.inMu.Lock()
	defer s.inMu.Unlock()
	_, err := s.in.Write(append(b, '\n'))
	return err
}

func (s *codexServer) call(method string, params any) (json.RawMessage, error) {
	s.mu.Lock()
	if s.dead {
		s.mu.Unlock()
		return nil, errors.New("codex app-server is not running")
	}
	s.next++
	id := s.next
	ch := make(chan rpcMsg, 1)
	s.pending[fmt.Sprint(id)] = ch
	s.mu.Unlock()
	if err := s.send(map[string]any{"id": id, "method": method, "params": params}); err != nil {
		return nil, err
	}
	select {
	case m := <-ch:
		if m.Error != nil {
			return nil, fmt.Errorf("codex %s: %s", method, m.Error.Message)
		}
		return m.Result, nil
	case <-time.After(2 * time.Minute):
		s.mu.Lock()
		delete(s.pending, fmt.Sprint(id))
		s.mu.Unlock()
		return nil, fmt.Errorf("codex %s: timed out", method)
	}
}

func (s *codexServer) reply(id json.RawMessage, result any) error {
	return s.send(map[string]any{"id": id, "result": result})
}

func (s *codexServer) replyErr(id json.RawMessage, msg string) {
	s.send(map[string]any{"id": id, "error": rpcErr{Code: -32601, Message: msg}})
}

func (s *codexServer) read(out io.Reader) {
	br := bufio.NewReaderSize(out, 1<<20)
	for {
		line, err := br.ReadBytes('\n')
		if len(line) > 1 {
			s.dispatch(line)
		}
		if err != nil {
			break
		}
	}
	s.cmd.Wait()
	s.mu.Lock()
	s.dead = true
	for _, ch := range s.pending {
		ch <- rpcMsg{Error: &rpcErr{Message: "codex app-server exited"}}
	}
	rts := s.rts
	s.rts = map[string]*codexRT{}
	s.mu.Unlock()
	for _, rt := range rts {
		rt.t.end()
	}
}

func (s *codexServer) dispatch(line []byte) {
	var m rpcMsg
	if json.Unmarshal(line, &m) != nil {
		return
	}
	if m.Method == "" { // response to one of our calls
		s.mu.Lock()
		ch := s.pending[string(m.ID)]
		delete(s.pending, string(m.ID))
		s.mu.Unlock()
		if ch != nil {
			ch <- m
		}
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
		s.replyErr(m.ID, "unsupported by luther: "+m.Method)
	case rt != nil:
		rt.onNotify(m.Method, m.Params)
	}
}

// ---- one open Codex thread ----

type codexRT struct {
	t  *Thread
	s  *codexServer
	id string // codex thread id

	mu    sync.Mutex
	turn  string // active turn id
	mode  string
	model string
	items map[string]map[string]any // in-flight items by id (approval bodies)
}

type codexPrompt struct {
	rpcID  json.RawMessage
	method string
}

type codexThreadResp struct {
	Model  string         `json:"model"`
	Thread codexThreadRec `json:"thread"`
}

type codexThreadRec struct {
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

// openCodex starts, resumes or forks a Codex thread. RPCs can take seconds
// (MCP servers start), so callers must not hold the threads lock.
func openCodex(r OpenReq) (*Thread, error) {
	s, err := codexSrv()
	if err != nil {
		return nil, err
	}
	mode := orDefault(r.Mode, ModeAsk)
	pol := codexPolicies[mode]
	params := map[string]any{"cwd": r.Cwd, "approvalPolicy": pol.approval, "sandbox": pol.sandbox}
	if r.Model != "" {
		params["model"] = r.Model
	}
	method := "thread/start"
	if r.Resume != "" {
		params["threadId"] = r.Resume
		method = "thread/resume"
		if r.Fork {
			method = "thread/fork"
		}
	}
	raw, err := s.call(method, params)
	if err != nil {
		return nil, err
	}
	var resp codexThreadResp
	if err := json.Unmarshal(raw, &resp); err != nil || resp.Thread.ID == "" {
		return nil, fmt.Errorf("codex %s: unexpected reply", method)
	}
	id := resp.Thread.ID
	t := newThread(id, State{Provider: Codex, Session: id, Cwd: orDefault(resp.Thread.Cwd, r.Cwd), Mode: mode, Model: resp.Model})
	rt := &codexRT{t: t, s: s, id: id, mode: mode, model: r.Model, items: map[string]map[string]any{}}
	t.rt = rt
	for _, turn := range resp.Thread.Turns {
		for _, it := range turn.Items {
			if m, ok := codexMsg(it); ok {
				t.msgs = append(t.msgs, m)
			}
		}
	}
	t.msgs = t.msgs[max(0, len(t.msgs)-keepMsgs):]
	s.mu.Lock()
	s.rts[id] = rt
	s.mu.Unlock()
	return t, nil
}

func (c *codexRT) onNotify(method string, raw json.RawMessage) {
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
				InputTokens  int64 `json:"inputTokens"`
				OutputTokens int64 `json:"outputTokens"`
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
		t.do(t.turnStart)
	case "item/started":
		id, _ := p.Item["id"].(string)
		c.mu.Lock()
		c.items[id] = p.Item
		c.mu.Unlock()
		t.do(func() {
			switch p.Item["type"] {
			case "agentMessage":
				t.st.Activity = ""
				t.resetDraft()
			case "reasoning":
				t.st.Activity = "Thinking…"
			case "commandExecution":
				t.st.Activity = "Running " + clip(str(p.Item, "command"), 40) + "…"
			case "fileChange":
				t.st.Activity = "Editing files…"
			case "mcpToolCall", "dynamicToolCall":
				t.st.Activity = "Calling " + str(p.Item, "tool") + "…"
			case "webSearch":
				t.st.Activity = "Searching the web…"
			}
		})
	case "item/agentMessage/delta":
		t.do(func() { t.delta(p.Delta) })
	case "item/completed":
		id, _ := p.Item["id"].(string)
		c.mu.Lock()
		delete(c.items, id)
		c.mu.Unlock()
		if m, ok := codexMsg(p.Item); ok {
			t.do(func() { t.add(m) })
		}
	case "thread/tokenUsage/updated":
		t.do(func() {
			t.st.Usage = &Usage{InputTokens: p.TokenUsage.Total.InputTokens, OutputTokens: p.TokenUsage.Total.OutputTokens}
		})
	case "serverRequest/resolved": // answered elsewhere or auto-resolved
		t.do(func() {
			for _, pr := range t.prompts {
				if cp, ok := pr.priv.(*codexPrompt); ok && string(cp.rpcID) == string(p.RequestID) {
					t.closePrompt(pr.ID)
					return
				}
			}
		})
	case "error":
		if !p.WillRetry && p.Error.Message != "" {
			t.do(func() { t.fail(p.Error.Message) })
		}
	case "turn/completed":
		c.mu.Lock()
		c.turn = ""
		c.mu.Unlock()
		t.do(func() {
			switch p.Turn["status"] {
			case "failed":
				if e, ok := p.Turn["error"].(map[string]any); ok {
					t.fail(fmt.Sprint(e["message"]))
				}
			case "interrupted":
				t.add(Msg{ID: "int-" + randHex(4), Role: "system", Text: "Interrupted"})
			}
			t.turnEnd()
		})
	}
}

func (c *codexRT) onRequest(rpcID json.RawMessage, method string, raw json.RawMessage) {
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
	pr := &Prompt{ID: "cx-" + randHex(6), priv: &codexPrompt{rpcID: rpcID, method: method}}
	approve := []Option{{Label: "Yes"}, {Label: "Yes, and don't ask again this session"}, {Label: "No"}}
	switch method {
	case "item/commandExecution/requestApproval":
		pr.Kind, pr.Tool, pr.Title, pr.Options = "permission", "Shell", "Run this command?", approve
		pr.Body = strings.TrimSpace(orDefault(p.Reason, "") + "\n$ " + clip(p.Command, 2000))
	case "item/fileChange/requestApproval":
		pr.Kind, pr.Tool, pr.Title, pr.Options = "permission", "Edit", "Apply these changes?", approve
		c.mu.Lock()
		item := c.items[p.ItemID]
		c.mu.Unlock()
		pr.Body = strings.TrimSpace(orDefault(p.Reason, "") + "\n" + fileChangeText(item, true))
	case "item/tool/requestUserInput":
		pr.Kind, pr.Tool, pr.Title = "question", "Question", "Codex has a question"
		for _, q := range p.Questions {
			qq := Question{ID: q.ID, Question: q.Question, Header: q.Header}
			for _, o := range q.Options {
				qq.Options = append(qq.Options, Option{Label: o.Label, Desc: o.Description})
			}
			pr.Questions = append(pr.Questions, qq)
		}
	case "mcpServer/elicitation/request":
		c.s.reply(rpcID, map[string]any{"action": "decline"}) // ponytail: MCP forms aren't rendered on the phone yet
		return
	case "item/permissions/requestApproval":
		pr.Kind, pr.Tool, pr.Title = "permission", "Permissions", "Allow extra permissions?"
		pr.Body = orDefault(p.Reason, "Codex asks for permissions beyond its sandbox.")
		pr.Options = []Option{{Label: "Yes, for this turn"}, {Label: "No"}}
		pr.priv.(*codexPrompt).method = method + "|" + string(raw)
	default:
		c.s.replyErr(rpcID, "unsupported by luther: "+method)
		return
	}
	c.t.do(func() { c.t.addPrompt(pr) })
}

func (c *codexRT) Answer(p *Prompt, a Answer) error {
	cp := p.priv.(*codexPrompt)
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
		if err := c.s.reply(cp.rpcID, map[string]any{"decision": decision}); err != nil {
			return err
		}
		if decision == "decline" && strings.TrimSpace(a.Message) != "" {
			return c.Send(a.Message) // "no, do this instead" steers the running turn
		}
		return nil
	case "item/tool/requestUserInput":
		ans := map[string]any{}
		for qid, labels := range a.Answers {
			ans[qid] = map[string]any{"answers": labels}
		}
		return c.s.reply(cp.rpcID, map[string]any{"answers": ans})
	case "item/permissions/requestApproval":
		granted := map[string]any{}
		if a.Choice == 0 {
			var req struct {
				Permissions map[string]any `json:"permissions"`
			}
			json.Unmarshal([]byte(rawParams), &req)
			granted = req.Permissions
		}
		return c.s.reply(cp.rpcID, map[string]any{"permissions": granted, "scope": "turn"})
	}
	return nil
}

func userInput(text string) []map[string]any {
	return []map[string]any{{"type": "text", "text": text}}
}

// Send starts a turn, or steers the running one.
func (c *codexRT) Send(text string) error {
	c.mu.Lock()
	turn, mode, model := c.turn, c.mode, c.model
	c.mu.Unlock()
	if turn != "" {
		_, err := c.s.call("turn/steer", map[string]any{"threadId": c.id, "expectedTurnId": turn, "input": userInput(text)})
		return err
	}
	pol := codexPolicies[mode]
	params := map[string]any{"threadId": c.id, "input": userInput(text), "approvalPolicy": pol.approval,
		"sandboxPolicy": map[string]any{"type": pol.sandboxType}}
	if model != "" {
		params["model"] = model
	}
	_, err := c.s.call("turn/start", params)
	return err
}

func (c *codexRT) Interrupt() error {
	c.mu.Lock()
	turn := c.turn
	c.mu.Unlock()
	if turn == "" {
		return errors.New("nothing is running")
	}
	_, err := c.s.call("turn/interrupt", map[string]any{"threadId": c.id, "turnId": turn})
	return err
}

// SetMode / SetModel apply from the next turn (Codex takes them per turn/start).
func (c *codexRT) SetMode(m string) error {
	c.mu.Lock()
	c.mode = m
	c.mu.Unlock()
	c.t.do(func() { c.t.st.Mode = m })
	return nil
}

func (c *codexRT) SetModel(m string) error {
	if m == "" {
		return errors.New("empty model")
	}
	c.mu.Lock()
	c.model = m
	c.mu.Unlock()
	c.t.do(func() { c.t.st.Model = m })
	return nil
}

// Stop unloads the thread from the shared app-server; its history stays in Codex's store.
func (c *codexRT) Stop() {
	c.s.call("thread/unsubscribe", map[string]any{"threadId": c.id})
	c.s.mu.Lock()
	delete(c.s.rts, c.id)
	c.s.mu.Unlock()
	c.t.end()
}

// ---- items → messages ----

func str(m map[string]any, k string) string { s, _ := m[k].(string); return s }

func codexMsg(it map[string]any) (Msg, bool) {
	id := str(it, "id")
	switch it["type"] {
	case "userMessage":
		var parts []string
		if cs, ok := it["content"].([]any); ok {
			for _, c := range cs {
				if cm, ok := c.(map[string]any); ok && cm["type"] == "text" {
					parts = append(parts, str(cm, "text"))
				}
			}
		}
		if len(parts) == 0 {
			return Msg{}, false
		}
		return Msg{ID: id, Role: "user", Text: strings.Join(parts, "\n")}, true
	case "agentMessage":
		if strings.TrimSpace(str(it, "text")) == "" {
			return Msg{}, false
		}
		return Msg{ID: id, Role: "assistant", Text: str(it, "text")}, true
	case "plan":
		return Msg{ID: id, Role: "assistant", Text: "**Plan**\n" + str(it, "text")}, true
	case "commandExecution":
		text := clip(str(it, "command"), 300)
		if code, ok := it["exitCode"].(float64); ok && code != 0 {
			text += fmt.Sprintf("  (exit %d)", int(code))
		}
		if it["status"] == "declined" {
			text += "  (declined)"
		}
		return Msg{ID: id, Role: "tool", Tool: "Shell", Text: text}, true
	case "fileChange":
		return Msg{ID: id, Role: "tool", Tool: "Edit", Text: fileChangeText(it, false)}, true
	case "mcpToolCall", "dynamicToolCall":
		name := str(it, "tool")
		if srv := str(it, "server"); srv != "" {
			name = srv + "." + name
		}
		return Msg{ID: id, Role: "tool", Tool: name}, true
	case "webSearch":
		return Msg{ID: id, Role: "tool", Tool: "WebSearch", Text: str(it, "query")}, true
	case "contextCompaction":
		return Msg{ID: id, Role: "system", Text: "Context compacted"}, true
	}
	return Msg{}, false
}

// fileChangeText: changed paths (relative), plus clipped diffs for approvals.
func fileChangeText(it map[string]any, diffs bool) string {
	var b strings.Builder
	cs, _ := it["changes"].([]any)
	for _, c := range cs {
		cm, _ := c.(map[string]any)
		path := str(cm, "path")
		kind := ""
		if k, ok := cm["kind"].(map[string]any); ok {
			kind = str(k, "type")
		}
		fmt.Fprintf(&b, "%s %s\n", kind, filepath.Base(path))
		if diffs {
			b.WriteString(clip(str(cm, "diff"), 1500) + "\n")
		}
	}
	return strings.TrimSpace(b.String())
}

// ---- past threads (Codex's own store, via the app-server) ----

func codexSessions(cwd string) []Session {
	s, err := codexSrv()
	if err != nil {
		return nil
	}
	params := map[string]any{"limit": 200}
	if cwd != "" {
		params["cwd"] = cwd
	}
	raw, err := s.call("thread/list", params) // ponytail: first page only (200 newest)
	if err != nil {
		return nil
	}
	var out struct {
		Data []codexThreadRec `json:"data"`
	}
	json.Unmarshal(raw, &out)
	var ss []Session
	for _, th := range out.Data {
		if th.Cwd == "" && len(th.Envs) > 0 {
			th.Cwd = th.Envs[0].Cwd
		}
		ss = append(ss, Session{Provider: Codex, ID: th.ID, Cwd: th.Cwd, Title: oneLine(orDefault(th.Name, th.Preview)),
			Preview: oneLine(th.Preview), LastActive: time.Unix(th.Updated, 0)})
	}
	return ss
}

func codexModels() []string {
	s, err := codexSrv()
	if err != nil {
		return nil
	}
	raw, err := s.call("model/list", map[string]any{})
	if err != nil {
		return nil
	}
	var out struct {
		Data []struct {
			ID    string `json:"id"`
			Model string `json:"model"`
		} `json:"data"`
	}
	json.Unmarshal(raw, &out)
	var ms []string
	for _, m := range out.Data {
		ms = append(ms, orDefault(m.ID, m.Model))
	}
	return ms
}

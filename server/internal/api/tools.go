package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/AJAmit17/luther/server/internal/acp"
	"github.com/AJAmit17/luther/server/internal/artifacts"
	"github.com/AJAmit17/luther/server/internal/auth"
	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/templates"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/AJAmit17/luther/server/internal/tools"
)

// The tools Luther gives every agent it runs (package tools relays them).
// An agent may start threads, and talk to and wait on the ones it started, but
// never with more access than its own thread has, and never touch your other
// threads.

const (
	waitDefault = 10 * time.Minute
	waitMax     = 30 * time.Minute
)

func toolRoutes(mux *http.ServeMux) {
	// The list is the same for every thread, so a token not yet bound may read it.
	mux.HandleFunc("GET /agent-tools", func(w http.ResponseWriter, r *http.Request) {
		if !tools.Issued(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")) || !auth.Direct(r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		httpx.WriteJSON(w, toolList())
	})
	mux.HandleFunc("POST /agent-tools/{name}", toolAuth(func(w http.ResponseWriter, r *http.Request, t *hub.Thread) {
		var args map[string]any
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, artifacts.MaxSize+(1<<20))).Decode(&args); err != nil {
			http.Error(w, "bad arguments: "+err.Error(), http.StatusBadRequest)
			return
		}
		out, err := callTool(r, t, r.PathValue("name"), args)
		if err != nil {
			httpx.WriteJSON(w, map[string]any{"text": err.Error(), "isError": true})
			return
		}
		httpx.WriteJSON(w, map[string]any{"text": out})
	}))
}

// toolAuth: the per-thread token, and only from this Mac.
func toolAuth(h func(http.ResponseWriter, *http.Request, *hub.Thread)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := tools.Thread(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		if id == "" || !auth.Direct(r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		t := hub.Find(id)
		if t == nil {
			http.Error(w, "this thread isn't open in Luther any more", http.StatusGone)
			return
		}
		h(w, r, t)
	}
}

func agentIDs() []string {
	ids := []string{string(protocol.Claude), string(protocol.Codex)}
	for _, a := range acp.Agents() {
		ids = append(ids, string(a.ID))
	}
	return ids
}

func toolList() []map[string]any {
	str := func(desc string) map[string]any { return map[string]any{"type": "string", "description": desc} }
	roles := []string{}
	for _, tp := range templates.List() {
		roles = append(roles, fmt.Sprintf("%s (%s)", tp.Name, tp.Description))
	}
	roleList := "none"
	if len(roles) > 0 {
		roleList = strings.Join(roles, "; ")
	}
	schema := func(props map[string]any, required ...string) map[string]any {
		return map[string]any{"type": "object", "properties": props, "required": required}
	}
	return []map[string]any{
		{
			"name": "show_artifact",
			"description": "Show the user an HTML page on their phone, as a card in this conversation that opens in a browser. " +
				"Use it for anything visual: a chart, a report, a diagram, a walkthrough. The page must be self-contained: " +
				"inline CSS and JavaScript (libraries from public CDNs are fine); it runs sandboxed, so forms, popups, cookies " +
				"and local storage don't work. Pass path (an .html file in your working folder; edit it and the user reopens " +
				"the card to see the new version) or html (the page itself, when you can't write files). At most 5 MB. " +
				"Make it readable on a phone, in light and dark.",
			"inputSchema": schema(map[string]any{
				"title": str("Short title for the card"),
				"path":  str("An .html file inside your working folder, relative to it"),
				"html":  str("The whole page, when not passing path"),
			}, "title"),
		},
		{
			"name": "start_thread",
			"description": "Start another coding agent on the user's Mac, in a new conversation the user can follow on their phone, " +
				"and give it a task. Returns its thread id; use wait_for_thread for its reply. It gets at most your own access. " +
				"Agents: " + strings.Join(agentIDs(), ", ") + ". Roles (template): " + roleList + ".",
			"inputSchema": schema(map[string]any{
				"agent":    map[string]any{"type": "string", "enum": agentIDs(), "description": "Which agent; may come from the template"},
				"prompt":   str("The task, complete enough to work on alone"),
				"template": str("A role to start it with (its instructions go first, and it may set agent, model and mode)"),
				"cwd":      str("Folder to work in (default: yours)"),
				"model":    str("Model id (default: the agent's)"),
				"mode":     map[string]any{"type": "string", "enum": []string{protocol.ModePlan, protocol.ModeAsk, protocol.ModeEdits, protocol.ModeFull}, "description": "plan (read-only), ask, edits or full; never more than yours (default: yours)"},
				"worktree": map[string]any{"type": "boolean", "description": "Work in a new git worktree and branch, so it doesn't touch your files"},
			}, "prompt"),
		},
		{
			"name":        "send_message",
			"description": "Send a follow-up to a thread you started (it queues if the agent is busy).",
			"inputSchema": schema(map[string]any{"thread": str("The thread id start_thread returned"), "text": str("The message")}, "thread", "text"),
		},
		{
			"name": "wait_for_thread",
			"description": "Wait until a thread you started finishes its turn or needs the user, then return its status and last reply. " +
				"timeout_seconds: default 600, at most 1800; 0 checks without waiting.",
			"inputSchema": schema(map[string]any{
				"thread":          str("The thread id start_thread returned"),
				"timeout_seconds": map[string]any{"type": "integer", "minimum": 0, "maximum": int(waitMax / time.Second)},
			}, "thread"),
		},
	}
}

func callTool(r *http.Request, t *hub.Thread, name string, args map[string]any) (string, error) {
	s := func(k string) string { v, _ := args[k].(string); return strings.TrimSpace(v) }
	switch name {
	case "show_artifact":
		title := s("title")
		html, _ := args["html"].(string)
		id, err := artifacts.Save(t.State().Cwd, title, s("path"), html)
		if err != nil {
			return "", err
		}
		t.Do(func(*protocol.State) { t.AddOnce(protocol.Msg{ID: id, Role: "artifact", Text: title}) })
		return fmt.Sprintf("Shown on the phone as %q.", title), nil

	case "start_thread":
		return startThread(t, s("agent"), s("prompt"), s("template"), s("cwd"), s("model"), s("mode"), args["worktree"] == true)

	case "send_message":
		child, err := childOf(t, s("thread"))
		if err != nil {
			return "", err
		}
		if s("text") == "" {
			return "", errors.New("text is required")
		}
		if err := child.Send(s("text"), nil); err != nil {
			return "", err
		}
		return "Sent.", nil

	case "wait_for_thread":
		child, err := childOf(t, s("thread"))
		if err != nil {
			return "", err
		}
		limit := waitDefault
		if v, ok := args["timeout_seconds"].(float64); ok {
			limit = min(time.Duration(v)*time.Second, waitMax)
		}
		deadline := time.Now().Add(limit)
		for {
			phase, reply := child.Status()
			if phase != "working" || !time.Now().Before(deadline) {
				return statusText(phase, reply), nil
			}
			select {
			case <-r.Context().Done():
				return "", r.Context().Err()
			case <-time.After(time.Second):
			}
		}
	}
	return "", fmt.Errorf("unknown tool %q", name)
}

func childOf(t *hub.Thread, id string) (*hub.Thread, error) {
	if !tools.IsChild(t.ID, id) {
		return nil, errors.New("you can only reach threads you started with start_thread")
	}
	child := hub.Find(id)
	if child == nil {
		return nil, errors.New("that thread has ended")
	}
	return child, nil
}

func statusText(phase, reply string) string {
	head := map[string]string{
		"working":  "Still working (the wait timed out). Wait again, or check on it later.",
		"waiting":  "It's waiting for the user (an approval or a question on their phone).",
		"failed":   "Its last turn failed.",
		"finished": "It finished its turn.",
		"idle":     "It hasn't replied yet.",
		"ended":    "The thread has ended.",
	}[phase]
	if reply == "" {
		return head
	}
	return head + "\n\nIts last reply:\n" + reply
}

var modeRank = map[string]int{protocol.ModePlan: 0, protocol.ModeAsk: 1, protocol.ModeEdits: 2, protocol.ModeFull: 3}

func startThread(parent *hub.Thread, agent, prompt, template, cwd, model, mode string, worktree bool) (string, error) {
	if prompt == "" {
		return "", errors.New("prompt is required")
	}
	pst := parent.State()
	if template != "" {
		tp, ok := templates.Get(template)
		if !ok {
			return "", fmt.Errorf("no template %q", template)
		}
		agent = text.OrDefault(agent, string(tp.Provider))
		mode = text.OrDefault(mode, tp.Mode)
	}
	if agent == "" {
		return "", errors.New("agent is required (or a template that names one)")
	}
	mode = text.OrDefault(mode, pst.Mode)
	r, ok := modeRank[mode]
	pr, pok := modeRank[pst.Mode]
	if !ok {
		return "", fmt.Errorf("unknown mode %q", mode)
	}
	if !pok || r > pr {
		return "", fmt.Errorf("can't start a thread in %q mode: yours is %q, and a thread you start gets at most your access", mode, pst.Mode)
	}
	cwd = text.OrDefault(cwd, pst.Cwd)
	if !filepath.IsAbs(cwd) {
		cwd = filepath.Join(pst.Cwd, cwd)
	}
	// A child works inside its parent's folder: an agent can't reach your other projects or home.
	rel, err := filepath.Rel(pst.Cwd, cwd)
	if _, ok := paths.Within(pst.Cwd, rel); err != nil || rel == ".." || strings.HasPrefix(rel, "../") || !ok {
		return "", fmt.Errorf("a thread you start works inside your folder (%s)", pst.Cwd)
	}
	// Started by a run nobody watches: the child is unattended too (deny rules, no waiting on approvals).
	child, _, err := open(protocol.OpenReq{Provider: protocol.Provider(agent), Cwd: cwd, Model: model, Mode: mode, Worktree: worktree, Template: template, Unattended: parent.IsUnattended()})
	if err != nil {
		return "", err
	}
	tools.AddChild(parent.ID, child.ID)
	child.Do(func(*protocol.State) {
		child.Add(protocol.Msg{ID: "from-" + text.RandHex(4), Role: "system",
			Text: fmt.Sprintf("Started by %s from %s", pst.Provider.Name(), filepath.Base(pst.Cwd))})
	})
	if err := child.Send(prompt, nil); err != nil {
		return "", err
	}
	cst := child.State()
	return fmt.Sprintf("Started %s in %s (thread %s, mode %s). Use wait_for_thread with this thread id for its reply.",
		cst.Provider.Name(), cst.Cwd, child.ID, cst.Mode), nil
}

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/AJAmit17/luther/server/internal/workspace"
)

// Compares: one prompt to several agents (or models), each in a new worktree
// of the project, so they can't step on each other or on you. Then keep one
// run's changes (applied to your checkout, uncommitted) or have an agent
// combine the best of them. Kept in ~/.luther/compares.json, the latest 30.

const (
	compareMax  = 5
	compareKeep = 30
)

var compares = struct {
	sync.Mutex
	list []*protocol.Compare // newest first
	read bool
}{}

func comparesFile() string { return filepath.Join(config.Dir(), "compares.json") }

func loadCompares() { // caller holds compares
	if compares.read {
		return
	}
	compares.read = true
	if b, err := os.ReadFile(comparesFile()); err == nil {
		json.Unmarshal(b, &compares.list)
	}
}

func saveCompares() { // caller holds compares
	b, _ := json.Marshal(compares.list)
	os.MkdirAll(config.Dir(), 0o700)
	os.WriteFile(comparesFile(), b, 0o600)
}

func compareRoutes(mux *http.ServeMux, wrap httpx.Wrap) {
	mux.HandleFunc("POST /compares", wrap(newCompare))
	mux.HandleFunc("GET /compares", wrap(func(w http.ResponseWriter, r *http.Request) {
		cwd := r.URL.Query().Get("cwd")
		compares.Lock()
		loadCompares()
		out := []protocol.Compare{}
		for _, c := range compares.list {
			if cwd == "" || c.Cwd == cwd {
				out = append(out, *c)
			}
		}
		compares.Unlock()
		for i := range out {
			out[i].Runs = live(out[i].Runs, false)
		}
		httpx.WriteJSON(w, out)
	}))
	mux.HandleFunc("GET /compares/{id}", wrap(func(w http.ResponseWriter, r *http.Request) {
		c, ok := findCompare(r.PathValue("id"))
		if !ok {
			http.Error(w, "no such comparison", http.StatusNotFound)
			return
		}
		c.Runs = live(c.Runs, true)
		httpx.WriteJSON(w, c)
	}))
	mux.HandleFunc("POST /compares/{id}/keep", wrap(keepRun))
	mux.HandleFunc("POST /compares/{id}/combine", wrap(combineRuns))
}

func findCompare(id string) (protocol.Compare, bool) {
	compares.Lock()
	defer compares.Unlock()
	loadCompares()
	for _, c := range compares.list {
		if c.ID == id {
			cc := *c
			cc.Runs = append([]protocol.CompareRun(nil), c.Runs...)
			return cc, true
		}
	}
	return protocol.Compare{}, false
}

// live fills each run's status and last reply (and, with stats, its diff size).
func live(runs []protocol.CompareRun, stats bool) []protocol.CompareRun {
	out := append([]protocol.CompareRun(nil), runs...)
	for i := range out {
		r := &out[i]
		if r.Thread == "" {
			r.Status = "failed"
			continue
		}
		r.Status = "ended"
		if t := hub.Find(r.Thread); t != nil {
			var reply string
			r.Status, reply = t.Status()
			r.Reply = text.Clip(strings.TrimSpace(reply), 600)
		}
		if stats && paths.IsDir(r.Worktree) {
			r.Files, r.Added, r.Removed = workspace.Changes(r.Worktree)
		}
	}
	return out
}

func newCompare(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Cwd    string `json:"cwd"`
		Prompt string `json:"prompt"`
		Mode   string `json:"mode"`
		Runs   []struct {
			Provider protocol.Provider `json:"provider"`
			Model    string            `json:"model"`
		} `json:"runs"`
	}
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	req.Mode = text.OrDefault(req.Mode, protocol.ModeEdits)
	switch {
	case req.Prompt == "":
		http.Error(w, "a comparison needs a prompt", http.StatusBadRequest)
		return
	case len(req.Runs) < 2 || len(req.Runs) > compareMax:
		http.Error(w, fmt.Sprintf("pick 2 to %d agents", compareMax), http.StatusBadRequest)
		return
	case !paths.ProjectDir(req.Cwd):
		http.Error(w, "cwd must be an existing folder inside your home folder", http.StatusBadRequest)
		return
	case !protocol.ValidMode(req.Mode):
		http.Error(w, "unknown mode", http.StatusBadRequest)
		return
	}
	c := &protocol.Compare{ID: text.RandHex(4), Cwd: req.Cwd, Prompt: req.Prompt, Mode: req.Mode, Created: time.Now().UnixMilli()}
	var mu sync.Mutex
	var wg sync.WaitGroup
	c.Runs = make([]protocol.CompareRun, len(req.Runs))
	for i, x := range req.Runs {
		wg.Add(1)
		go func() { // agents take seconds to start: start them together
			defer wg.Done()
			run := protocol.CompareRun{Provider: x.Provider, Model: x.Model}
			t, _, err := open(protocol.OpenReq{Provider: x.Provider, Cwd: req.Cwd, Model: x.Model, Mode: req.Mode, Worktree: true})
			if err == nil {
				err = t.Send(req.Prompt, nil)
			}
			if err != nil {
				run.Error = err.Error()
			} else {
				st := t.State()
				run.Thread, run.Session, run.Worktree = t.ID, st.Session, st.Cwd
			}
			mu.Lock()
			c.Runs[i] = run
			mu.Unlock()
		}()
	}
	wg.Wait()
	compares.Lock()
	loadCompares()
	compares.list = append([]*protocol.Compare{c}, compares.list...)
	compares.list = compares.list[:min(len(compares.list), compareKeep)]
	saveCompares()
	compares.Unlock()
	httpx.WriteJSON(w, c)
}

// keepRun: one run's changes into your checkout, uncommitted, for you to review.
func keepRun(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Thread string `json:"thread"`
	}
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	c, ok := findCompare(r.PathValue("id"))
	if !ok {
		http.Error(w, "no such comparison", http.StatusNotFound)
		return
	}
	var run *protocol.CompareRun
	for i := range c.Runs {
		if c.Runs[i].Thread == req.Thread && req.Thread != "" {
			run = &c.Runs[i]
		}
	}
	if run == nil {
		http.Error(w, "that run isn't part of this comparison", http.StatusBadRequest)
		return
	}
	if t := hub.Find(run.Thread); t != nil {
		if phase, _ := t.Status(); phase == "working" || phase == "waiting" {
			http.Error(w, "that agent is still working: wait for it, or stop it first", http.StatusConflict)
			return
		}
	}
	if err := workspace.CarryOver(run.Worktree, c.Cwd); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	compares.Lock()
	for _, x := range compares.list {
		if x.ID == c.ID {
			x.Kept = run.Thread
		}
	}
	saveCompares()
	compares.Unlock()
}

const combinePrompt = `Several coding agents each did this task in their own git worktree:

%s

Their work, one worktree each (uncommitted changes; see them with git -C <folder> diff HEAD, and git -C <folder> status for new files):
%s

Compare their changes, pick the best ideas from each, and make one combined change here, in %s. Don't modify the worktrees. Then explain in a few lines what you took from which, and why.`

// combineRuns: a new thread in your checkout that merges the best of the runs.
func combineRuns(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Provider protocol.Provider `json:"provider"`
	}
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	c, ok := findCompare(r.PathValue("id"))
	if !ok {
		http.Error(w, "no such comparison", http.StatusNotFound)
		return
	}
	var lines []string
	for _, x := range c.Runs {
		if x.Worktree == "" || !paths.IsDir(x.Worktree) {
			continue
		}
		who := x.Provider.Name()
		if x.Model != "" {
			who += " (" + x.Model + ")"
		}
		lines = append(lines, fmt.Sprintf("- %s: %s", who, x.Worktree))
	}
	if len(lines) < 2 {
		http.Error(w, "fewer than two runs left anything to combine", http.StatusBadRequest)
		return
	}
	sort.Strings(lines)
	t, status, err := open(protocol.OpenReq{Provider: protocol.Provider(text.OrDefault(string(req.Provider), string(protocol.Claude))), Cwd: c.Cwd, Mode: protocol.ModeEdits})
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	if err := t.Send(fmt.Sprintf(combinePrompt, c.Prompt, strings.Join(lines, "\n"), c.Cwd), nil); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	httpx.WriteJSON(w, map[string]string{"id": t.ID})
}

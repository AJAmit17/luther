// Package sessions: every past conversation on this Mac, across agents, and the
// projects they ran in. History stays in each CLI's own store (read-only); what
// Luther adds — your titles, pins, archive — lives in ~/.luther/sessions.json.
// Sessions that ran in a Luther worktree fold into the project they came from.
package sessions

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/AJAmit17/luther/server/internal/claude"
	"github.com/AJAmit17/luther/server/internal/codex"
	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/terminal"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/AJAmit17/luther/server/internal/workspace"
)

// Routes: GET /projects, GET /sessions, PATCH /sessions/{provider}/{id}.
func Routes(mux *http.ServeMux, wrap httpx.Wrap) {
	mux.HandleFunc("GET /projects", wrap(projects))
	mux.HandleFunc("GET /sessions", wrap(list))
	mux.HandleFunc("PATCH /sessions/{provider}/{id}", wrap(patch))
}

// Titles: session id → display title (yours if renamed), for open-thread lists.
func Titles() map[string]string {
	out := map[string]string{}
	for _, s := range all("") {
		out[s.ID] = s.Title
	}
	return out
}

// ---- Luther-side metadata ----

type meta struct {
	Title    string `json:"title,omitempty"`
	Pinned   bool   `json:"pinned,omitempty"`
	Archived bool   `json:"archived,omitempty"`
}

var store = struct {
	sync.Mutex
	m map[string]meta // "<provider>:<id>"
}{}

func metaPath() string { return filepath.Join(config.Dir(), "sessions.json") }

func metas() map[string]meta {
	store.Lock()
	defer store.Unlock()
	if store.m == nil {
		store.m = map[string]meta{}
		if b, err := os.ReadFile(metaPath()); err == nil {
			json.Unmarshal(b, &store.m)
		}
	}
	out := make(map[string]meta, len(store.m))
	for k, v := range store.m {
		out[k] = v
	}
	return out
}

func patch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title    *string
		Pinned   *bool
		Archived *bool
	}
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	metas() // load
	key := r.PathValue("provider") + ":" + r.PathValue("id")
	store.Lock()
	defer store.Unlock()
	m := store.m[key]
	if req.Title != nil {
		m.Title = text.Clip(strings.TrimSpace(*req.Title), 120)
	}
	if req.Pinned != nil {
		m.Pinned = *req.Pinned
	}
	if req.Archived != nil {
		m.Archived = *req.Archived
	}
	if m == (meta{}) {
		delete(store.m, key)
	} else {
		store.m[key] = m
	}
	b, _ := json.MarshalIndent(store.m, "", "  ")
	os.MkdirAll(config.Dir(), 0o700)
	if err := os.WriteFile(metaPath(), b, 0o600); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// ---- the list ----

var parents sync.Map // worktree cwd → main checkout (git asks are slow-ish)

// home: the project a cwd belongs to (a worktree's main checkout).
func home(cwd string) (project, branch string) {
	if !workspace.IsWorktree(cwd) {
		return cwd, ""
	}
	if p, ok := parents.Load(cwd); ok {
		return p.(string), workspace.Branch(cwd)
	}
	p := workspace.Parent(cwd)
	if p == "" {
		return cwd, ""
	}
	parents.Store(cwd, p)
	return p, workspace.Branch(cwd)
}

// all: every agent's sessions (for project cwd, or all), newest first; pinned
// first; live / busy / your metadata filled in.
func all(cwd string) []protocol.Session {
	var ss []protocol.Session
	for _, s := range append(claude.Sessions(), codex.Sessions("")...) {
		p, branch := home(s.Cwd)
		if cwd == "" || p == cwd {
			s.Worktree = branch
			ss = append(ss, s)
		}
	}
	busy := claude.Busy()
	live := map[string]string{}
	for _, t := range hub.List() {
		live[t.ID], live[t.State().Session] = t.ID, t.ID
	}
	ms := metas()
	for i := range ss {
		s := &ss[i]
		s.Live = live[s.ID]
		s.Busy = s.Provider == protocol.Claude && busy[s.ID] && s.Live == ""
		if m, ok := ms[string(s.Provider)+":"+s.ID]; ok {
			s.Title = text.OrDefault(m.Title, s.Title)
			s.Pinned, s.Archived = m.Pinned, m.Archived
		}
	}
	sort.Slice(ss, func(i, j int) bool {
		if ss[i].Pinned != ss[j].Pinned {
			return ss[i].Pinned
		}
		return ss[i].LastActive.After(ss[j].LastActive)
	})
	return ss
}

// list: GET /sessions?cwd= (one project) or ?q= (search everywhere); archived
// ones only with &archived=1.
func list(w http.ResponseWriter, r *http.Request) {
	cwd, q := r.URL.Query().Get("cwd"), strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if cwd != "" && !paths.InHome(cwd) {
		http.Error(w, "cwd must be inside your home folder", http.StatusBadRequest)
		return
	}
	archived := r.URL.Query().Get("archived") == "1"
	out := []protocol.Session{}
	for _, s := range all(cwd) {
		if s.Archived != archived {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(s.Title+" "+s.Preview+" "+s.Cwd), q) {
			continue
		}
		out = append(out, s)
	}
	httpx.WriteJSON(w, out)
}

// projects: folders sessions ran in (gone or outside $HOME hidden), worktrees
// folded into their repo, plus folders with only an open thread or terminal.
// Live ones first, then most recently active.
func projects(w http.ResponseWriter, r *http.Request) {
	by := map[string]*protocol.Project{}
	get := func(cwd string) *protocol.Project {
		cwd, _ = home(cwd)
		p := by[cwd]
		if p == nil {
			p = &protocol.Project{Cwd: cwd, Name: filepath.Base(cwd)}
			by[cwd] = p
		}
		return p
	}
	for _, s := range all("") {
		if s.Archived {
			continue
		}
		p := get(s.Cwd)
		p.Sessions++
		if s.LastActive.After(p.LastActive) {
			p.LastActive = s.LastActive
		}
	}
	for _, t := range hub.List() {
		get(t.State().Cwd).Live++
	}
	for _, tm := range terminal.List() {
		get(tm.Cwd).Live++
	}
	out := []protocol.Project{}
	for cwd, p := range by {
		if paths.ProjectDir(cwd) {
			out = append(out, *p)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if (out[i].Live > 0) != (out[j].Live > 0) {
			return out[i].Live > 0
		}
		return out[i].LastActive.After(out[j].LastActive)
	})
	httpx.WriteJSON(w, out)
}

// Package api: the composition root. It builds the HTTP server from every
// feature package's routes, and owns the few endpoints that need several of them
// (opening a thread picks the agent adapter; listing open threads adds titles).
package api

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/AJAmit17/luther/server/internal/auth"
	"github.com/AJAmit17/luther/server/internal/claude"
	"github.com/AJAmit17/luther/server/internal/codex"
	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/env"
	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/sessions"
	"github.com/AJAmit17/luther/server/internal/terminal"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/AJAmit17/luther/server/internal/uploads"
	"github.com/AJAmit17/luther/server/internal/workspace"
)

// Handler: every route of `luther serve`.
func Handler(cfg *config.Config) http.Handler {
	mux := http.NewServeMux()
	a := auth.New(cfg)
	wrap := httpx.Wrap(a.Wrap)

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteJSON(w, map[string]any{"ok": true, "name": cfg.DisplayName(), "version": protocol.Version})
	})
	a.Routes(mux)
	hub.Routes(mux, wrap)
	sessions.Routes(mux, wrap)
	terminal.Routes(mux, wrap)
	workspace.Routes(mux, wrap)
	uploads.Routes(mux, wrap)

	mux.HandleFunc("POST /threads", wrap(openThread))
	mux.HandleFunc("GET /threads", wrap(listOpen))
	mux.HandleFunc("GET /providers", wrap(providers))
	mux.HandleFunc("GET /models", wrap(models))
	mux.HandleFunc("GET /commands", wrap(commands))
	mux.HandleFunc("GET /dirs", wrap(dirs))
	return mux
}

// Serve runs the server on 127.0.0.1 (tailscale serve / cloudflared proxy to it).
func Serve(cfg *config.Config) {
	env.LoginPath()
	env.CleanEnv()
	// Keep the Mac awake (on AC) while Luther runs.
	exec.Command("caffeinate", "-is", "-w", strconv.Itoa(os.Getpid())).Start()
	go hub.ReapIdle()
	go claude.WatchDups()
	addr := fmt.Sprintf("127.0.0.1:%d", cfg.Port)
	log.Printf("luther %s listening on http://%s", protocol.Version, addr)
	log.Fatal(http.ListenAndServe(addr, Handler(cfg)))
}

// openThread: POST /threads OpenReq → {id}. Attaches to the thread already
// hosting the session, else starts, resumes or forks one (in a new worktree if
// asked). 409 if a CLI outside Luther holds the session.
func openThread(w http.ResponseWriter, r *http.Request) {
	var req protocol.OpenReq
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	if !paths.ProjectDir(req.Cwd) {
		http.Error(w, "cwd must be an existing folder inside your home folder", http.StatusBadRequest)
		return
	}
	if req.Mode != "" && !protocol.ValidMode(req.Mode) {
		http.Error(w, "unknown mode", http.StatusBadRequest)
		return
	}
	if req.Resume != "" && !req.Fork {
		if t := hub.Find(req.Resume); t != nil {
			httpx.WriteJSON(w, map[string]string{"id": t.ID})
			return
		}
	}
	if req.Worktree {
		dir, err := workspace.NewWorktree(req.Cwd)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		req.Cwd = dir
	}
	var t *hub.Thread
	var err error
	switch req.Provider {
	case protocol.Claude:
		t, err = claude.Open(req)
	case protocol.Codex:
		t, err = codex.Open(req)
	default:
		http.Error(w, "unknown provider", http.StatusBadRequest)
		return
	}
	switch {
	case errors.Is(err, claude.ErrHeld):
		http.Error(w, err.Error(), http.StatusConflict)
		return
	case err != nil:
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if got := hub.Register(t); got != t { // lost a race with another open
		t.Runtime().Stop()
		t = got
	}
	httpx.WriteJSON(w, map[string]string{"id": t.ID})
}

func listOpen(w http.ResponseWriter, r *http.Request) {
	titles := sessions.Titles()
	out := []protocol.ThreadInfo{}
	for _, t := range hub.List() {
		st := t.State()
		st.Commands = nil
		out = append(out, protocol.ThreadInfo{ID: t.ID, State: st, Title: titles[st.Session], Clients: t.Clients()})
	}
	httpx.WriteJSON(w, out)
}

func providers(w http.ResponseWriter, r *http.Request) {
	ver := func(bin string) (string, bool) {
		out, err := exec.Command(bin, "--version").Output()
		return strings.TrimSpace(string(out)), err == nil
	}
	cv, cok := ver(claude.Bin)
	xv, xok := ver(codex.Bin)
	modes := []string{protocol.ModeAsk, protocol.ModeEdits, protocol.ModePlan, protocol.ModeFull}
	httpx.WriteJSON(w, []protocol.ProviderInfo{
		{ID: protocol.Claude, Name: "Claude Code", Installed: cok, Version: cv, Modes: modes},
		{ID: protocol.Codex, Name: "Codex", Installed: xok, Version: xv, Modes: modes},
	})
}

func models(w http.ResponseWriter, r *http.Request) {
	switch protocol.Provider(r.URL.Query().Get("provider")) {
	case protocol.Claude:
		httpx.WriteJSON(w, []string{"opus", "sonnet", "haiku"}) // CLI aliases; the CLI resolves the latest of each
	case protocol.Codex:
		httpx.WriteJSON(w, httpx.OrEmpty(codex.Models()))
	default:
		http.Error(w, "unknown provider", http.StatusBadRequest)
	}
}

func commands(w http.ResponseWriter, r *http.Request) {
	cwd := r.URL.Query().Get("cwd")
	if cwd != "" && !paths.InHome(cwd) {
		http.Error(w, "cwd must be inside your home folder", http.StatusBadRequest)
		return
	}
	if protocol.Provider(r.URL.Query().Get("provider")) == protocol.Claude {
		httpx.WriteJSON(w, claude.Commands(text.OrDefault(cwd, paths.Home)))
		return
	}
	httpx.WriteJSON(w, []protocol.Command{}) // Codex's slash commands are TUI-only
}

// dirs: GET /dirs?path= → subfolders (default $HOME), hidden ones excluded.
func dirs(w http.ResponseWriter, r *http.Request) {
	p := text.OrDefault(r.URL.Query().Get("path"), paths.Home)
	if !paths.InHome(p) {
		http.Error(w, "path must be inside your home folder", http.StatusBadRequest)
		return
	}
	ents, err := os.ReadDir(p)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	out := []string{}
	for _, e := range ents {
		if !strings.HasPrefix(e.Name(), ".") && (e.IsDir() || paths.IsDir(filepath.Join(p, e.Name()))) {
			out = append(out, filepath.Join(p, e.Name()))
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i]) < strings.ToLower(out[j]) })
	httpx.WriteJSON(w, out)
}

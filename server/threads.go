package main

import (
	"errors"
	"net/http"
	"os/exec"
	"strings"
)

// openThread: POST /threads OpenReq → {id}. Attaches to the thread already
// hosting the session, else starts or resumes one. 409 if a CLI outside Luther holds it.
func (s *server) openThread(w http.ResponseWriter, r *http.Request) {
	var req OpenReq
	if !readJSON(w, r, &req) {
		return
	}
	if !inHome(req.Cwd) || !isDir(req.Cwd) {
		http.Error(w, "cwd must be an existing folder inside your home folder", http.StatusBadRequest)
		return
	}
	if req.Mode != "" && !validMode(req.Mode) {
		http.Error(w, "unknown mode", http.StatusBadRequest)
		return
	}
	if req.Resume != "" && !req.Fork {
		if t := findThread(req.Resume); t != nil {
			writeJSON(w, map[string]string{"id": t.ID})
			return
		}
	}
	var t *Thread
	var err error
	switch req.Provider {
	case Claude:
		threads.Lock()
		if req.Resume != "" && !req.Fork {
			t = findThreadLocked(req.Resume) // lost a race with another open
		}
		if t == nil {
			t, err = openClaude(req)
		}
		threads.Unlock()
	case Codex:
		if t, err = openCodex(req); err == nil {
			register(t)
		}
	default:
		http.Error(w, "unknown provider", http.StatusBadRequest)
		return
	}
	switch {
	case errors.Is(err, errHeld):
		http.Error(w, err.Error(), http.StatusConflict)
	case err != nil:
		http.Error(w, err.Error(), http.StatusBadGateway)
	default:
		writeJSON(w, map[string]string{"id": t.ID})
	}
}

func (s *server) listOpen(w http.ResponseWriter, r *http.Request) {
	titles := map[string]string{}
	for _, ss := range claudeIndex.Sessions() {
		titles[ss.ID] = ss.Title
	}
	out := []ThreadInfo{}
	for _, t := range listThreads() {
		st := t.State()
		st.Commands = nil
		out = append(out, ThreadInfo{ID: t.ID, State: st, Title: titles[st.Session], Clients: t.Clients()})
	}
	writeJSON(w, out)
}

func (s *server) stopThread(w http.ResponseWriter, r *http.Request) {
	t := findThread(r.PathValue("id"))
	if t == nil {
		http.Error(w, "no such open thread", http.StatusNotFound)
		return
	}
	t.rt.Stop()
}

func (s *server) interruptThread(w http.ResponseWriter, r *http.Request) {
	t := findThread(r.PathValue("id"))
	if t == nil {
		http.Error(w, "no such open thread", http.StatusNotFound)
		return
	}
	if err := t.rt.Interrupt(); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
	}
}

func (s *server) providers(w http.ResponseWriter, r *http.Request) {
	ver := func(bin string) (string, bool) {
		out, err := exec.Command(bin, "--version").Output()
		return strings.TrimSpace(string(out)), err == nil
	}
	cv, cok := ver(claudeBin)
	xv, xok := ver(codexBin)
	writeJSON(w, []ProviderInfo{
		{ID: Claude, Name: "Claude Code", Installed: cok, Version: cv, Modes: []string{ModeAsk, ModeEdits, ModePlan, ModeFull}},
		{ID: Codex, Name: "Codex", Installed: xok, Version: xv, Modes: []string{ModeAsk, ModeEdits, ModePlan, ModeFull}},
	})
}

func (s *server) models(w http.ResponseWriter, r *http.Request) {
	switch Provider(r.URL.Query().Get("provider")) {
	case Claude:
		writeJSON(w, []string{"opus", "sonnet", "haiku"}) // CLI aliases; the CLI resolves the latest of each
	case Codex:
		writeJSON(w, orEmpty(codexModels()))
	default:
		http.Error(w, "unknown provider", http.StatusBadRequest)
	}
}

func (s *server) commands(w http.ResponseWriter, r *http.Request) {
	cwd := r.URL.Query().Get("cwd")
	if cwd != "" && !inHome(cwd) {
		http.Error(w, "cwd must be inside your home folder", http.StatusBadRequest)
		return
	}
	if Provider(r.URL.Query().Get("provider")) == Claude {
		writeJSON(w, claudeCommands(orDefault(cwd, home)))
		return
	}
	writeJSON(w, []Command{}) // Codex's slash commands are TUI-only
}

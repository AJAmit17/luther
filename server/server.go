package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type server struct{}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		cfgMu.Lock()
		name := cfg.Name
		cfgMu.Unlock()
		writeJSON(w, map[string]any{"ok": true, "name": name, "version": version})
	})
	mux.HandleFunc("POST /pair", s.pair)
	mux.HandleFunc("POST /pair/code", s.auth(s.pairCode))
	mux.HandleFunc("GET /devices", s.auth(s.listDevices))
	mux.HandleFunc("DELETE /devices/{id}", s.auth(s.revokeDevice))
	mux.HandleFunc("POST /devices/push", s.auth(s.setPush))
	mux.HandleFunc("GET /dirs", s.auth(s.dirs))
	mux.HandleFunc("GET /providers", s.auth(s.providers))
	mux.HandleFunc("GET /models", s.auth(s.models))
	mux.HandleFunc("GET /projects", s.auth(s.projects))
	mux.HandleFunc("GET /sessions", s.auth(s.sessions))
	mux.HandleFunc("GET /commands", s.auth(s.commands))
	mux.HandleFunc("POST /threads", s.auth(s.openThread))
	mux.HandleFunc("GET /threads", s.auth(s.listOpen))
	mux.HandleFunc("DELETE /threads/{id}", s.auth(s.stopThread))
	mux.HandleFunc("GET /threads/{id}/events", s.auth(s.threadEvents))
	mux.HandleFunc("GET /terms", s.auth(s.terms))
	mux.HandleFunc("POST /terms", s.auth(s.newTerm))
	mux.HandleFunc("DELETE /terms/{name}", s.auth(s.killTerm))
	mux.HandleFunc("GET /terms/{name}/events", s.auth(s.termEvents))
	mux.HandleFunc("GET /files", s.auth(s.files))
	mux.HandleFunc("GET /git/status", s.auth(s.gitStatus))
	mux.HandleFunc("GET /git/diff", s.auth(s.gitDiff))
	mux.HandleFunc("POST /git/commit", s.auth(s.gitCommit))
	return mux
}

// dirs: GET /dirs?path= → subfolders (default $HOME), hidden ones excluded.
func (s *server) dirs(w http.ResponseWriter, r *http.Request) {
	p := orDefault(r.URL.Query().Get("path"), home)
	if !inHome(p) {
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
		if !strings.HasPrefix(e.Name(), ".") && (e.IsDir() || isDir(filepath.Join(p, e.Name()))) {
			out = append(out, filepath.Join(p, e.Name()))
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i]) < strings.ToLower(out[j]) })
	writeJSON(w, out)
}

func serve() {
	loginPath()
	cleanEnv()
	// Keep the Mac awake (on AC) while Luther runs.
	exec.Command("caffeinate", "-is", "-w", strconv.Itoa(os.Getpid())).Start()
	go reapIdle()
	go watchDups()
	addr := fmt.Sprintf("127.0.0.1:%d", cfg.Port)
	log.Printf("luther %s listening on http://%s (tailscale serve / cloudflared proxy here)", version, addr)
	log.Fatal(http.ListenAndServe(addr, (&server{}).routes()))
}

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
	mux.HandleFunc("GET /dirs", s.auth(s.dirs))
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
	addr := fmt.Sprintf("127.0.0.1:%d", cfg.Port)
	log.Printf("luther %s listening on http://%s (tailscale serve / cloudflared proxy here)", version, addr)
	log.Fatal(http.ListenAndServe(addr, (&server{}).routes()))
}

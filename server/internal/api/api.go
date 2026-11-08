// Package api: the composition root. It builds the HTTP server from every
// feature package's routes, and owns the few endpoints that need several of them
// (opening a thread picks the agent adapter; listing open threads adds titles).
package api

import (
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/AJAmit17/luther/server/internal/acp"
	"github.com/AJAmit17/luther/server/internal/artifacts"
	"github.com/AJAmit17/luther/server/internal/auth"
	"github.com/AJAmit17/luther/server/internal/claude"
	"github.com/AJAmit17/luther/server/internal/codex"
	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/e2e"
	"github.com/AJAmit17/luther/server/internal/env"
	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/preview"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/remote"
	"github.com/AJAmit17/luther/server/internal/restore"
	"github.com/AJAmit17/luther/server/internal/schedule"
	"github.com/AJAmit17/luther/server/internal/sessions"
	"github.com/AJAmit17/luther/server/internal/templates"
	"github.com/AJAmit17/luther/server/internal/terminal"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/AJAmit17/luther/server/internal/tools"
	"github.com/AJAmit17/luther/server/internal/tunnel"
	"github.com/AJAmit17/luther/server/internal/uploads"
	"github.com/AJAmit17/luther/server/internal/usage"
	"github.com/AJAmit17/luther/server/internal/workspace"
)

// Handler: every route of `luther serve`.
func Handler(cfg *config.Config) http.Handler {
	selfPort = cfg.Port
	mux := http.NewServeMux()
	a := auth.New(cfg)
	wrap := httpx.Wrap(a.Wrap)

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		// Name and version only to this Mac (the CLI): from outside they'd
		// fingerprint the server and often name its owner.
		if !auth.Direct(r) {
			httpx.WriteJSON(w, map[string]any{"ok": true})
			return
		}
		httpx.WriteJSON(w, map[string]any{"ok": true, "name": cfg.DisplayName(), "version": protocol.Version})
	})
	// The addresses this Mac answers on now: the phone refreshes its list from
	// it, so a quick tunnel's new address reaches it.
	mux.HandleFunc("GET /routes", wrap(func(w http.ResponseWriter, r *http.Request) { httpx.WriteJSON(w, httpx.OrEmpty(cfg.Routes())) }))
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
	mux.HandleFunc("GET /usage", wrap(limits))
	mux.HandleFunc("GET /templates", wrap(func(w http.ResponseWriter, r *http.Request) { httpx.WriteJSON(w, templates.List()) }))
	mux.HandleFunc("POST /walkthroughs", wrap(walkthrough))
	artifacts.Routes(mux, wrap)
	toolRoutes(mux)
	compareRoutes(mux, wrap)
	usage.Routes(mux, wrap)
	schedule.Start(mux, wrap, open)
	remote.Start(mux, wrap, func(r *http.Request) bool { return auth.DeviceID(r) == auth.Admin })
	e2e.Routes(mux, a, mux, cfg.Port)
	preview.Routes(mux, wrap, cfg.Port) // last: it owns "/"
	return mux
}

// sweepToolConfigs: Claude's tool configs left by a crash (each holds a token
// that died with the server; a running claude read its own at start).
func sweepToolConfigs() {
	dir := filepath.Join(config.Dir(), "mcp")
	ents, _ := os.ReadDir(dir)
	for _, e := range ents {
		if fi, err := e.Info(); err == nil && time.Since(fi.ModTime()) > 24*time.Hour {
			os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

// selfPort: where this server listens, for the agents' tool server to call back.
var selfPort = config.DefaultPort

// Serve runs the server on 127.0.0.1 (tailscale serve / cloudflared proxy to it).
func Serve(cfg *config.Config) {
	env.LoginPath()
	env.CleanEnv()
	if goruntime.GOOS == "darwin" { // keep the Mac awake (on AC) while Luther runs
		if err := exec.Command("/usr/bin/caffeinate", "-is", "-w", strconv.Itoa(os.Getpid())).Start(); err != nil {
			log.Printf("idle sleep prevention unavailable: %v", err)
		}
	}
	go hub.ReapIdle()
	go claude.WatchDups()
	go warmModels()
	go housekeeping()
	go tunnel.KeepQuick(fmt.Sprintf("http://127.0.0.1:%d", cfg.Port))
	// A named tunnel on your own domain, if one is configured (read fresh: the
	// CLI sets it while this runs).
	go tunnel.KeepNamed(func() bool { c, err := config.Load(); return err == nil && c.Tunnel != "" })
	addr := fmt.Sprintf("127.0.0.1:%d", cfg.Port)
	log.Printf("luther %s listening on http://%s", protocol.Version, addr)
	// Header and idle timeouts against slow or idle connections from the
	// internet; no read/write timeout, which would cut WebSockets.
	srv := &http.Server{Addr: addr, Handler: Handler(cfg), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatal(err)
	}
	// Threads that were working when Luther last stopped come back, once it
	// listens (their agents start Luther's tool server, which calls back).
	go restore.Resume(open)
	go restore.Keep()
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
		<-sig
		if err := restore.Save(); err != nil {
			log.Printf("save running threads: %v", err)
		}
		os.Exit(0)
	}()
	log.Fatal(srv.Serve(ln))
}

// openThread: POST /threads OpenReq → {id}. Attaches to the thread already
// hosting the session, else starts, resumes or forks one (in a new worktree if
// asked). 409 if a CLI outside Luther holds the session.
func openThread(w http.ResponseWriter, r *http.Request) {
	var req protocol.OpenReq
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	t, status, err := open(req)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	httpx.WriteJSON(w, map[string]string{"id": t.ID})
}

// open: a registered thread for req, or the HTTP status that explains why not.
// The scheduler opens its runs through here too.
func open(req protocol.OpenReq) (*hub.Thread, int, error) {
	if !paths.ProjectDir(req.Cwd) {
		return nil, http.StatusBadRequest, errors.New("cwd must be an existing folder inside your home folder")
	}
	if req.Mode != "" && !protocol.ValidMode(req.Mode) {
		return nil, http.StatusBadRequest, errors.New("unknown mode")
	}
	if req.Resume != "" && !req.Fork {
		if t := hub.Find(req.Resume); t != nil {
			return t, 200, nil
		}
	}
	var role *protocol.Template
	if req.Template != "" {
		tp, ok := templates.Get(req.Template)
		if !ok {
			return nil, http.StatusBadRequest, errors.New("no such template")
		}
		role = &tp
		req.Provider = protocol.Provider(text.OrDefault(string(req.Provider), string(tp.Provider)))
		req.Model = text.OrDefault(req.Model, tp.Model)
		req.Mode = text.OrDefault(req.Mode, tp.Mode)
	}
	if req.Worktree {
		dir, err := workspace.NewWorktree(req.Cwd)
		if err != nil {
			return nil, http.StatusBadRequest, err
		}
		req.Cwd = dir
	}
	tok, spec := tools.ForThread(selfPort)
	req.Tools = spec
	var t *hub.Thread
	var err error
	switch req.Provider {
	case protocol.Claude:
		t, err = claude.Open(req)
	case protocol.Codex:
		t, err = codex.Open(req)
	default:
		a, ok := acp.Find(req.Provider)
		if !ok {
			return nil, http.StatusBadRequest, errors.New("unknown provider")
		}
		t, err = acp.Open(a, req)
	}
	switch {
	case errors.Is(err, claude.ErrHeld):
		tools.Drop(tok)
		return nil, http.StatusConflict, err
	case err != nil:
		tools.Drop(tok)
		return nil, http.StatusBadGateway, err
	}
	if got := hub.Register(t); got != t { // lost a race with another open
		t.Runtime().Stop()
		t = got
	}
	tools.Bind(tok, t.ID)
	if req.Unattended {
		t.SetUnattended()
	}
	if role != nil {
		t.SetPrefix(role.Instructions)
	}
	return t, 200, nil
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
	out := []protocol.ProviderInfo{
		{ID: protocol.Claude, Name: "Claude Code", Installed: cok, Version: cv, Modes: modes},
		{ID: protocol.Codex, Name: "Codex", Installed: xok, Version: xv, Modes: modes},
	}
	for _, a := range acp.Agents {
		v, ok := a.Version()
		out = append(out, protocol.ProviderInfo{ID: a.ID, Name: a.Name, Installed: ok, Version: v, Modes: modes})
	}
	httpx.WriteJSON(w, out)
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

// limits: GET /usage. Both are asked fresh: Codex over its app-server,
// Claude at Anthropic's usage endpoint (its turns report too).
func limits(w http.ResponseWriter, r *http.Request) {
	if _, err := exec.LookPath(codex.Bin); err == nil {
		codex.ReadLimits()
	}
	if err := claude.ReadLimits(); err != nil {
		log.Print(err) // the last reported numbers still show
	}
	httpx.WriteJSON(w, usage.All())
}

// housekeeping, at start and hourly: old uploads go, and the service log
// (launchd writes ~/.luther/serve.log) stays under 5 MB.
func housekeeping() {
	for {
		uploads.Sweep()
		artifacts.Prune()
		sweepToolConfigs()
		env.CapLog(filepath.Join(config.Dir(), "serve.log"), 5<<20)
		time.Sleep(time.Hour)
	}
}

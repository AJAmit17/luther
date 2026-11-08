package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/AJAmit17/luther/server/internal/acp"
	"github.com/AJAmit17/luther/server/internal/codex"
	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/oneshot"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/AJAmit17/luther/server/internal/workspace"
)

// The workbench extras: a commit message written from the diff, one shell
// command, and Luther's health, log and agent restarts.

var started = time.Now()

func workbenchRoutes(mux *http.ServeMux, wrap httpx.Wrap, cfg *config.Config) {
	mux.HandleFunc("POST /git/message", wrap(commitMessage))
	mux.HandleFunc("POST /shell", wrap(runShell))
	mux.HandleFunc("GET /health", wrap(func(w http.ResponseWriter, r *http.Request) { httpx.WriteJSON(w, health(cfg)) }))
	mux.HandleFunc("GET /logs", wrap(logs))
	mux.HandleFunc("POST /agents/{id}/restart", wrap(restartAgent))
}

const messageSchema = `{"type":"object","properties":{"subject":{"type":"string"},"body":{"type":"string"}},"required":["subject","body"],"additionalProperties":false}`

const messageAsk = `Write a git commit message for the change below.

subject: what the change does, in the imperative, at most 72 characters, no trailing period.
body: why, and anything a reviewer should know, in a few short lines wrapped at 72 characters; empty if the subject says it all. No lists of files, no sign-off or attribution lines.

The change:
` + "```diff\n%s\n```"

func commitMessage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Cwd      string            `json:"cwd"`
		Provider protocol.Provider `json:"provider"`
	}
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	if !paths.ProjectDir(req.Cwd) {
		http.Error(w, "cwd must be an existing folder inside your home folder", http.StatusBadRequest)
		return
	}
	diff, err := workspace.WorkingDiff(req.Cwd, 300<<10)
	if err == nil && strings.TrimSpace(diff) == "" {
		err = errors.New("nothing to commit")
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	diff = clean(diff)
	if len(diff) > 60<<10 {
		diff = text.Clip(diff, 60<<10) + "\n(cut: the rest is too long)"
	}
	raw, err := oneshot.Ask(req.Provider, fmt.Sprintf(messageAsk, diff), messageSchema)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	var m struct {
		Subject string `json:"subject"`
		Body    string `json:"body"`
	}
	if json.Unmarshal(raw, &m) != nil || strings.TrimSpace(m.Subject) == "" {
		http.Error(w, "the model gave no message", http.StatusBadGateway)
		return
	}
	httpx.WriteJSON(w, map[string]string{"subject": strings.TrimSpace(m.Subject), "body": strings.TrimSpace(m.Body)})
}

const (
	shellTimeout = 2 * time.Minute
	shellMax     = 64 << 10
)

// runShell: one command in the project, through your login shell, with a
// time limit; its output (both streams) and exit code. Like a terminal, it
// runs with your rights.
func runShell(w http.ResponseWriter, r *http.Request) {
	var req struct{ Cwd, Command string }
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	if !paths.ProjectDir(req.Cwd) || strings.TrimSpace(req.Command) == "" {
		http.Error(w, "need a project folder and a command", http.StatusBadRequest)
		return
	}
	sh := text.OrDefault(os.Getenv("SHELL"), "/bin/zsh")
	ctx, cancel := context.WithTimeout(r.Context(), shellTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, sh, "-lc", req.Command)
	cmd.Dir = req.Cwd
	cmd.Stdin = nil
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	code := 0
	var exit *exec.ExitError
	switch {
	case errors.As(err, &exit):
		code = exit.ExitCode()
	case err != nil:
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	s := out.String()
	if ctx.Err() == context.DeadlineExceeded {
		s += "\n(stopped after 2 minutes)"
	}
	if len(s) > shellMax {
		s = "…" + s[len(s)-shellMax:] // the end is what matters
	}
	httpx.WriteJSON(w, map[string]any{"output": strings.ToValidUTF8(s, "�"), "code": code})
}

func health(cfg *config.Config) protocol.Health {
	h := protocol.Health{Version: protocol.Version, Started: started.UnixMilli(), Name: cfg.DisplayName()}
	count := map[protocol.Provider]int{}
	for _, t := range hub.List() {
		count[t.State().Provider]++
	}
	for _, p := range providerInfos() {
		a := protocol.AgentHealth{ID: p.ID, Name: p.Name, Installed: p.Installed, Version: p.Version, Threads: count[p.ID]}
		switch p.ID {
		case protocol.Claude:
			a.Running = count[p.ID] > 0
		case protocol.Codex:
			a.Running, _ = codex.Running()
		default:
			a.Running, _ = acp.Running(p.ID)
		}
		h.Agents = append(h.Agents, a)
	}
	return h
}

// logs: GET /logs?lines=N (default 400, at most 3000): the end of serve.log.
func logs(w http.ResponseWriter, r *http.Request) {
	n, _ := strconv.Atoi(r.URL.Query().Get("lines"))
	if n <= 0 {
		n = 400
	}
	n = min(n, 3000)
	f, err := os.Open(filepath.Join(config.Dir(), "serve.log"))
	if err != nil {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte("No log yet: Luther writes ~/.luther/serve.log when it runs as a service (luther start)."))
		return
	}
	defer f.Close()
	fi, _ := f.Stat()
	const window = 1 << 20
	off := max(0, fi.Size()-window)
	f.Seek(off, io.SeekStart)
	b, _ := io.ReadAll(f)
	lines := strings.Split(strings.TrimRight(string(b), "\n"), "\n")
	if off > 0 && len(lines) > 1 {
		lines = lines[1:] // the first is cut
	}
	lines = lines[max(0, len(lines)-n):]
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte(strings.ToValidUTF8(strings.Join(lines, "\n"), "�")))
}

// restartAgent: Codex and ACP agents share one process each, which is
// stopped (its threads end; reopening resumes them). Claude runs one process
// per thread: its threads are stopped.
func restartAgent(w http.ResponseWriter, r *http.Request) {
	id := protocol.Provider(r.PathValue("id"))
	switch id {
	case protocol.Claude:
		for _, t := range hub.List() {
			if t.State().Provider == protocol.Claude {
				t.Runtime().Stop()
			}
		}
	case protocol.Codex:
		codex.Restart()
	default:
		if _, ok := acp.Find(id); !ok {
			http.Error(w, "unknown agent", http.StatusBadRequest)
			return
		}
		acp.Restart(id)
	}
}

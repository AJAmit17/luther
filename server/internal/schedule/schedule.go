// Package schedule: agent runs on a timetable. Each job opens a new thread
// (optionally in its own worktree) and sends its prompt whenever its cron
// expression matches; the phone hears about it like any run (notifications,
// Live Activity, approvals). Jobs live in ~/.luther/schedules.json. Runs missed
// while the server was down or the machine slept are skipped, not caught up.
package schedule

import (
	"encoding/json"
	"errors"
	"log"
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
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
)

// Opener: how a run gets its thread (the api package's open).
type Opener func(protocol.OpenReq) (*hub.Thread, int, error)

type scheduler struct {
	open Opener
	mu   sync.Mutex
	jobs map[string]*protocol.Job
}

func file() string { return filepath.Join(config.Dir(), "schedules.json") }

// Start loads the jobs, ticks every minute, and serves the routes:
// GET /schedules, POST /schedules, DELETE /schedules/{id}, POST /schedules/{id}/run.
func Start(mux *http.ServeMux, wrap httpx.Wrap, open Opener) {
	s := &scheduler{open: open, jobs: map[string]*protocol.Job{}}
	if b, err := os.ReadFile(file()); err == nil {
		var list []*protocol.Job
		json.Unmarshal(b, &list)
		for _, j := range list {
			s.jobs[j.ID] = j
		}
	}
	mux.HandleFunc("GET /schedules", wrap(func(w http.ResponseWriter, r *http.Request) { httpx.WriteJSON(w, s.list()) }))
	mux.HandleFunc("POST /schedules", wrap(s.put))
	mux.HandleFunc("DELETE /schedules/{id}", wrap(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		_, ok := s.jobs[r.PathValue("id")]
		delete(s.jobs, r.PathValue("id"))
		s.saveLocked()
		s.mu.Unlock()
		if !ok {
			http.Error(w, "no such schedule", http.StatusNotFound)
		}
	}))
	mux.HandleFunc("POST /schedules/{id}/run", wrap(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		j := s.jobs[r.PathValue("id")]
		s.mu.Unlock()
		if j == nil {
			http.Error(w, "no such schedule", http.StatusNotFound)
			return
		}
		id, err := s.run(j.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		httpx.WriteJSON(w, map[string]string{"thread": id})
	}))
	go s.tick()
}

func (s *scheduler) list() []protocol.Job {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []protocol.Job{}
	for _, j := range s.jobs {
		jj := *j
		if c, err := Parse(j.Cron); err == nil && j.Enabled {
			jj.Next = c.Next(time.Now()).UnixMilli()
		}
		out = append(out, jj)
	}
	sort.Slice(out, func(i, k int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[k].Name) })
	return out
}

func (s *scheduler) put(w http.ResponseWriter, r *http.Request) {
	var j protocol.Job
	if !httpx.ReadJSON(w, r, &j) {
		return
	}
	j.Name, j.Prompt = strings.TrimSpace(j.Name), strings.TrimSpace(j.Prompt)
	if _, err := Parse(j.Cron); err != nil {
		http.Error(w, "schedule: "+err.Error(), http.StatusBadRequest)
		return
	}
	if j.Prompt == "" || j.Cwd == "" || j.Provider == "" {
		http.Error(w, "a schedule needs a project, an agent and a prompt", http.StatusBadRequest)
		return
	}
	if j.Mode != "" && !protocol.ValidMode(j.Mode) {
		http.Error(w, "unknown mode", http.StatusBadRequest)
		return
	}
	j.Name = text.OrDefault(j.Name, text.OneLine(j.Prompt))
	s.mu.Lock()
	if old := s.jobs[j.ID]; old != nil { // update: keep the run history
		j.LastRun, j.LastThread, j.LastError = old.LastRun, old.LastThread, old.LastError
	} else {
		j.ID = text.RandHex(6)
	}
	j.Next = 0
	s.jobs[j.ID] = &j
	err := s.saveLocked()
	s.mu.Unlock()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	httpx.WriteJSON(w, j)
}

func (s *scheduler) saveLocked() error {
	list := make([]*protocol.Job, 0, len(s.jobs))
	for _, j := range s.jobs {
		list = append(list, j)
	}
	b, _ := json.MarshalIndent(list, "", "  ")
	os.MkdirAll(config.Dir(), 0o700)
	return os.WriteFile(file(), b, 0o600)
}

// tick: at the top of every minute, start the jobs due.
func (s *scheduler) tick() {
	for {
		now := time.Now()
		time.Sleep(now.Truncate(time.Minute).Add(time.Minute).Sub(now))
		at := time.Now().Truncate(time.Minute)
		s.mu.Lock()
		var due []string
		for _, j := range s.jobs {
			if c, err := Parse(j.Cron); err == nil && j.Enabled && c.Match(at) {
				due = append(due, j.ID)
			}
		}
		s.mu.Unlock()
		for _, id := range due {
			go func() {
				if _, err := s.run(id); err != nil {
					log.Printf("schedule %s: %v", id, err)
				}
			}()
		}
	}
}

// run: a new thread for job id, sent its prompt; the outcome is recorded.
func (s *scheduler) run(id string) (string, error) {
	s.mu.Lock()
	j := s.jobs[id]
	if j == nil {
		s.mu.Unlock()
		return "", errors.New("no such schedule")
	}
	req := protocol.OpenReq{Provider: j.Provider, Cwd: j.Cwd, Mode: j.Mode, Model: j.Model, Worktree: j.Worktree}
	prompt := j.Prompt
	s.mu.Unlock()

	t, _, err := s.open(req)
	if err == nil {
		err = t.Send(prompt, nil)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if j = s.jobs[id]; j != nil {
		j.LastRun, j.LastError, j.LastThread = time.Now().UnixMilli(), "", ""
		if err != nil {
			j.LastError = err.Error()
		} else {
			j.LastThread = t.ID
		}
		s.saveLocked()
	}
	if err != nil {
		return "", err
	}
	return t.ID, nil
}

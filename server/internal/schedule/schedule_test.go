package schedule

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

type quiet struct{}

func (quiet) Send(string, []string) error                    { return nil }
func (quiet) Interrupt() error                               { return nil }
func (quiet) Answer(*protocol.Prompt, protocol.Answer) error { return nil }
func (quiet) SetMode(string) error                           { return nil }
func (quiet) SetModel(string) error                          { return nil }
func (quiet) SetEffort(string) error                         { return nil }
func (quiet) SetFast(bool) error                             { return nil }
func (quiet) Stop()                                          {}

func TestRunsAreUnattendedAndRecorded(t *testing.T) {
	paths.Home = t.TempDir()
	watchEvery = 5 * time.Millisecond
	var got protocol.OpenReq
	var th *hub.Thread
	s := &scheduler{jobs: map[string]*protocol.Job{}, open: func(r protocol.OpenReq) (*hub.Thread, int, error) {
		got = r
		th = hub.New("run-1", protocol.State{Provider: r.Provider, Session: "sess-1", Cwd: r.Cwd})
		th.SetRuntime(quiet{})
		return th, 200, nil
	}}
	s.jobs["j"] = &protocol.Job{ID: "j", Name: "Nightly", Cron: "0 3 * * *", Enabled: true, Provider: protocol.Claude, Cwd: "/x", Prompt: "Check the deps"}
	if _, err := s.run("j", true); err != nil {
		t.Fatal(err)
	}
	if !got.Unattended {
		t.Fatal("a scheduled run must be unattended")
	}
	run := s.jobs["j"].Runs[0]
	if run.Status != "working" || run.Session != "sess-1" || !run.Manual {
		t.Fatalf("started: %+v", run)
	}
	th.Do(func(*protocol.State) {
		th.TurnStart()
		th.Add(protocol.Msg{ID: "a", Role: "assistant", Text: "All deps current."})
		th.TurnEnd()
	})
	for i := 0; i < 200; i++ {
		s.mu.Lock()
		r := s.jobs["j"].Runs[0]
		s.mu.Unlock()
		if r.Status == "finished" {
			if r.Report != "All deps current." || r.Read {
				t.Fatalf("finished: %+v", r)
			}
			goto read
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the run was never recorded as finished")
read:
	mux := http.NewServeMux()
	s.routes(mux, func(h http.HandlerFunc) http.HandlerFunc { return h })
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/schedules/j/read", nil))
	if rec.Code != 200 || !s.jobs["j"].Runs[0].Read {
		t.Fatalf("read: %d %+v", rec.Code, s.jobs["j"].Runs[0])
	}
}

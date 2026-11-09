package restore

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

func init() { paths.Home, _ = os.MkdirTemp("", "restore-test-") }

func TestDue(t *testing.T) {
	now := time.Now()
	ms := func(d time.Duration) int64 { return now.Add(-d).UnixMilli() }
	got := Due([]Entry{
		{Provider: "claude", Session: "a", Cwd: "/x", Saved: ms(time.Minute)},
		{Provider: "claude", Session: "a", Cwd: "/x", Saved: ms(time.Minute)},  // twice
		{Provider: "codex", Session: "b", Cwd: "/x", Saved: ms(3 * time.Hour)}, // too old
		{Provider: "codex", Session: "", Cwd: "/x", Saved: ms(time.Minute)},
		{Provider: "devin", Session: "c", Cwd: "/y", Saved: ms(time.Hour)},
	}, now)
	if len(got) != 2 || got[0].Session != "a" || got[1].Session != "c" {
		t.Fatalf("due: %+v", got)
	}
}

func TestRunningKeepsUnattended(t *testing.T) {
	th := hub.New("sched-1", protocol.State{Provider: protocol.Claude, Session: "sched-1", Cwd: "/x", Mode: protocol.ModeFull})
	th.SetRuntime(nopRT{})
	th.SetUnattended()
	hub.Register(th)
	defer th.End()
	th.Do(func(*protocol.State) { th.TurnStart() })
	var got *Entry
	for _, e := range Running() {
		if e.Session == "sched-1" {
			got = &e
		}
	}
	if got == nil || !got.Unattended || got.Mode != protocol.ModeFull {
		t.Fatalf("saved: %+v", got)
	}
	var req protocol.OpenReq
	b, _ := json.Marshal([]Entry{{Provider: got.Provider, Session: "s2", Cwd: "/x", Unattended: true, Saved: time.Now().UnixMilli()}})
	os.MkdirAll(filepath.Dir(file()), 0o700)
	os.WriteFile(file(), b, 0o600)
	Resume(func(r protocol.OpenReq) (*hub.Thread, int, error) {
		req = r
		x := hub.New("s2", protocol.State{Provider: r.Provider})
		x.SetRuntime(nopRT{})
		return x, 200, nil
	})
	if !req.Unattended {
		t.Fatal("an unattended run came back attended")
	}
}

type nopRT struct{}

func (nopRT) Send(string, []string) error                    { return nil }
func (nopRT) Interrupt() error                               { return nil }
func (nopRT) Answer(*protocol.Prompt, protocol.Answer) error { return nil }
func (nopRT) SetMode(string) error                           { return nil }
func (nopRT) SetModel(string) error                          { return nil }
func (nopRT) SetEffort(string) error                         { return nil }
func (nopRT) SetFast(bool) error                             { return nil }
func (nopRT) Stop()                                          {}

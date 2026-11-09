package hub

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/AJAmit17/luther/server/internal/goal"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

type rec struct {
	mu   sync.Mutex
	sent []string
}

func (r *rec) Send(m string, _ []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sent = append(r.sent, m)
	return nil
}
func (r *rec) n() int                                         { r.mu.Lock(); defer r.mu.Unlock(); return len(r.sent) }
func (r *rec) Interrupt() error                               { return nil }
func (r *rec) Answer(*protocol.Prompt, protocol.Answer) error { return nil }
func (r *rec) SetMode(string) error                           { return nil }
func (r *rec) SetModel(string) error                          { return nil }
func (r *rec) SetEffort(string) error                         { return nil }
func (r *rec) SetFast(bool) error                             { return nil }
func (r *rec) Stop()                                          {}

// turn: the agent replies and its turn ends.
func turn(t *Thread, reply string) {
	t.Do(func(*protocol.State) {
		t.TurnStart()
		t.Add(protocol.Msg{ID: reply, Role: "assistant", Text: reply})
		t.TurnEnd()
	})
}

func waitFor(t *testing.T, th *Thread, status string) *protocol.Goal {
	t.Helper()
	for i := 0; i < 200; i++ {
		if g := th.State().Goal; g != nil && g.Status == status {
			return g
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("goal never reached %q: %+v", status, th.State().Goal)
	return nil
}

func TestGoal(t *testing.T) {
	verdicts := []goal.Verdict{{Verdict: "continue", Reason: "Add tests"}, {Verdict: "done", Reason: "Tests pass"}}
	var mu sync.Mutex
	Judge = func(_ protocol.Provider, obj, reply string) (goal.Verdict, error) {
		mu.Lock()
		defer mu.Unlock()
		v := verdicts[0]
		verdicts = verdicts[1:]
		return v, nil
	}
	defer func() { Judge = goal.Judge }()

	r := &rec{}
	th := New("g1", protocol.State{Provider: protocol.Claude})
	th.SetRuntime(r)
	if err := th.SetGoal("Ship the fix", 5); err != nil || r.n() != 1 || !strings.Contains(r.sent[0], "Ship the fix") {
		t.Fatalf("first round: %v %v", err, r.sent)
	}
	turn(th, "Fixed it.")
	g := waitFor(t, th, "working")
	for i := 0; i < 200 && r.n() < 2; i++ {
		time.Sleep(5 * time.Millisecond)
	}
	if g.Round != 2 || g.Note != "Add tests" || r.n() != 2 || !strings.Contains(r.sent[1], "Still missing: Add tests") {
		t.Fatalf("second round: %+v %v", g, r.sent)
	}
	turn(th, "Tests added and passing.")
	if g := waitFor(t, th, "done"); g.Note != "Tests pass" || r.n() != 2 {
		t.Fatalf("done: %+v %v", g, r.sent)
	}
}

func TestGoalLimitsAndStops(t *testing.T) {
	defer func() { Judge = goal.Judge }()
	r := &rec{}
	th := New("g2", protocol.State{Provider: protocol.Codex})
	th.SetRuntime(r)

	// The round limit.
	Judge = func(protocol.Provider, string, string) (goal.Verdict, error) {
		return goal.Verdict{Verdict: "continue", Reason: "more"}, nil
	}
	th.SetGoal("x", 1)
	turn(th, "a")
	waitFor(t, th, "limit")

	// Blocked twice in a row.
	Judge = func(protocol.Provider, string, string) (goal.Verdict, error) {
		return goal.Verdict{Verdict: "blocked", Reason: "needs a key"}, nil
	}
	th.SetGoal("y", 10)
	turn(th, "b")
	waitFor(t, th, "working")
	turn(th, "c")
	waitFor(t, th, "blocked")

	// A judge that fails pauses the goal; a failed turn stops it.
	Judge = func(protocol.Provider, string, string) (goal.Verdict, error) {
		return goal.Verdict{}, errors.New("no judge")
	}
	th.SetGoal("z", 10)
	turn(th, "d")
	waitFor(t, th, "paused")
	th.SetGoal("w", 10)
	th.Do(func(*protocol.State) { th.TurnStart(); th.Fail("boom"); th.TurnEnd() })
	waitFor(t, th, "failed")

	// Stop while the judge thinks: its verdict is dropped.
	release := make(chan struct{})
	Judge = func(protocol.Provider, string, string) (goal.Verdict, error) {
		<-release
		return goal.Verdict{Verdict: "continue"}, nil
	}
	th.SetGoal("v", 10)
	sent := r.n()
	turn(th, "e")
	waitFor(t, th, "judging")
	th.StopGoal()
	close(release)
	time.Sleep(30 * time.Millisecond)
	if g := th.State().Goal; g.Status != "stopped" || r.n() != sent {
		t.Fatalf("after stop: %+v, sent %d → %d", g, sent, r.n())
	}
}

// answers records what a fake agent was told.
type answers struct {
	rec
	got []protocol.Answer
}

func (a *answers) Answer(_ *protocol.Prompt, x protocol.Answer) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.got = append(a.got, x)
	return nil
}

func TestUnattendedDeclines(t *testing.T) {
	a := &answers{}
	th := New("u1", protocol.State{Provider: protocol.Claude})
	th.SetRuntime(a)
	th.SetUnattended()
	th.Do(func(*protocol.State) {
		th.TurnStart()
		th.AddPrompt(&protocol.Prompt{ID: "p1", Kind: "permission", Title: "Run rm?"})
		th.AddPrompt(&protocol.Prompt{ID: "q1", Kind: "question", Questions: []protocol.Question{{ID: "which", Question: "Which DB?"}}})
	})
	for i := 0; i < 200; i++ {
		a.mu.Lock()
		n := len(a.got)
		a.mu.Unlock()
		if n == 2 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.got) != 2 {
		t.Fatalf("answers: %+v", a.got)
	}
	for _, x := range a.got {
		if x.ID == "p1" && (x.Choice != -1 || x.Message != Unattended) {
			t.Fatalf("permission: %+v", x)
		}
		if x.ID == "q1" && x.Answers["which"][0] != Unattended {
			t.Fatalf("question: %+v", x)
		}
	}
	if phase, _ := th.Status(); phase == "waiting" {
		t.Fatal("an unattended thread was left waiting")
	}
}

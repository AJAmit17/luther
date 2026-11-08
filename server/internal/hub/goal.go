package hub

import (
	"errors"
	"fmt"
	"strings"

	"github.com/AJAmit17/luther/server/internal/goal"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
)

// Goals: the user sets an objective; the thread works on it and, after each
// turn, a judge decides. Continue sends the next round (with what's missing),
// done and blocked stop it, and so does the round limit, a failed turn, a
// judge that can't answer, or the user (Stop, or Stop goal).

const (
	DefaultRounds = 10
	MaxRounds     = 50
	blockedLimit  = 2 // blocked verdicts in a row before the goal stops
)

// Judge: swapped in tests.
var Judge = goal.Judge

type goalRun struct {
	blocked int    // blocked verdicts in a row
	gen     int    // bumps when the goal is set again or stopped: stale judges drop out
	turn    string // the reply being judged
}

// SetGoal starts working toward objective: the first round is sent now.
func (t *Thread) SetGoal(objective string, rounds int) error {
	objective = strings.TrimSpace(objective)
	if objective == "" {
		return errors.New("a goal needs an objective")
	}
	if rounds <= 0 {
		rounds = DefaultRounds
	}
	rounds = min(rounds, MaxRounds)
	t.Do(func(st *protocol.State) {
		st.Goal = &protocol.Goal{Objective: objective, Rounds: rounds, Round: 1, Status: "working"}
		t.gr.gen++
		t.gr.blocked = 0
		t.Add(protocol.Msg{ID: "goal-" + text.RandHex(4), Role: "system", Text: fmt.Sprintf("Goal set: up to %d rounds", rounds)})
	})
	return t.Send("Goal: "+objective+"\n\nWork until it's done. After each of your turns Luther checks whether the goal is met and, if it isn't, asks you to continue.", nil)
}

// StopGoal: no more rounds (the current turn, if any, carries on).
func (t *Thread) StopGoal() {
	t.Do(func(st *protocol.State) {
		if st.Goal != nil && (st.Goal.Status == "working" || st.Goal.Status == "judging") {
			t.endGoal("stopped", "Stopped by you")
		}
	})
}

// endGoal: hub lock held.
func (t *Thread) endGoal(status, note string) {
	g := *t.st.Goal
	g.Status, g.Note = status, note
	t.st.Goal = &g
	t.gr.gen++
	head := map[string]string{"done": "Goal reached", "blocked": "Goal blocked", "limit": "Goal stopped after the last round",
		"stopped": "Goal stopped", "failed": "Goal stopped: the turn failed", "paused": "Goal paused"}[status]
	if note != "" {
		head += ": " + note
	}
	t.Add(protocol.Msg{ID: "goal-" + text.RandHex(4), Role: "system", Text: head})
}

// goalTurnEnd: hub lock held, from TurnEnd. Starts the judge for a working goal.
func (t *Thread) goalTurnEnd() {
	g := t.st.Goal
	if g == nil || g.Status != "working" {
		return
	}
	if t.failed != "" {
		t.endGoal("failed", text.OneLine(t.failed))
		return
	}
	gg := *g
	gg.Status, gg.Note = "judging", ""
	t.st.Goal = &gg
	gen, reply, prov := t.gr.gen, t.lastText, t.st.Provider
	go t.judge(gen, prov, gg.Objective, reply)
}

func (t *Thread) judge(gen int, prov protocol.Provider, objective, reply string) {
	v, err := Judge(prov, objective, reply)
	next := ""
	t.Do(func(st *protocol.State) {
		g := st.Goal
		if t.gr.gen != gen || g == nil || g.Status != "judging" || t.ended {
			return // stopped or replaced while the judge thought
		}
		switch {
		case err != nil:
			t.endGoal("paused", err.Error())
		case v.Verdict == "done":
			t.endGoal("done", v.Reason)
		case v.Verdict == "blocked" && t.gr.blocked+1 >= blockedLimit:
			t.endGoal("blocked", v.Reason)
		case g.Round >= g.Rounds:
			t.endGoal("limit", v.Reason)
		default:
			if v.Verdict == "blocked" {
				t.gr.blocked++
			} else {
				t.gr.blocked = 0
			}
			gg := *g
			gg.Round++
			gg.Status, gg.Note = "working", v.Reason
			st.Goal = &gg
			next = "Keep going toward the goal: " + g.Objective
			if v.Reason != "" {
				next += "\n\nStill missing: " + v.Reason
			}
		}
	})
	if next != "" {
		if err := t.Send(next, nil); err != nil {
			t.Do(func(st *protocol.State) {
				if st.Goal != nil && t.gr.gen == gen {
					t.endGoal("paused", err.Error())
				}
			})
		}
	}
}

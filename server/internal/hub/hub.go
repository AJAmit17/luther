// Package hub: one Thread per open conversation, whatever the agent. An agent
// adapter (claude, codex) implements Runtime and reports events through Do; the
// hub keeps what every client needs (state, messages, draft, prompts, run
// summary, turn checkpoints) and fans frames out to all of them. Input from any
// client goes to the single Runtime, so every phone sees the same conversation.
package hub

import (
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/AJAmit17/luther/server/internal/checkpoint"
	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/AJAmit17/luther/server/internal/uploads"
)

// Runtime is the agent side of one open thread: the seam the adapters fill.
// Send may be called while a turn runs (the adapter queues or steers).
type Runtime interface {
	Send(text string, files []string) error
	Interrupt() error
	Answer(p *protocol.Prompt, a protocol.Answer) error
	SetMode(mode string) error
	SetModel(model string) error
	SetEffort(level string) error
	SetFast(on bool) error
	Stop() // async; the adapter calls End when its process is gone
}

const (
	keepMsgs = 300
	idleStop = 30 * time.Minute
	maxTurns = 50
)

type Thread struct {
	ID string // native session id it was opened with; stable even after /clear
	rt Runtime

	mu       sync.Mutex
	st       protocol.State
	lastSt   string
	msgs     []protocol.Msg
	draft    string
	prompts  []*protocol.Prompt
	subs     map[*sub]bool
	touched  time.Time
	since    time.Time // current turn start
	lastText string    // last assistant text: the "finished" detail
	failed   string    // error of the current turn, if any
	run      protocol.Run
	turns    []*checkpoint.Checkpoint
	ended    bool
	prefix   string    // a role's instructions, put before the first message sent
	asked    time.Time // a message was sent and its turn hasn't started yet
	gr       goalRun
	alone    bool // unattended: prompts are declined, not waited on
}

type sub struct{ ch chan []byte }

var registry = struct {
	sync.Mutex
	m map[string]*Thread
}{m: map[string]*Thread{}}

// New makes an unregistered thread; give it a Runtime, then Register it.
func New(id string, st protocol.State) *Thread {
	return &Thread{ID: id, st: st, subs: map[*sub]bool{}, touched: time.Now()}
}

func (t *Thread) SetRuntime(rt Runtime) { t.rt = rt }
func (t *Thread) Runtime() Runtime      { return t.rt }

// SetHistory: messages from the agent's own store, before Register.
func (t *Thread) SetHistory(msgs []protocol.Msg) { t.msgs = msgs[max(0, len(msgs)-keepMsgs):] }

// SetPrefix: instructions to put before the next message sent (a role's).
func (t *Thread) SetPrefix(s string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.prefix = s
}

// Status: where the thread stands, for an agent waiting on it: working,
// waiting (on the user), failed, finished or idle; and its last reply.
func (t *Thread) Status() (phase, reply string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	switch {
	case t.ended:
		phase = "ended"
	case len(t.prompts) > 0:
		phase = "waiting"
	case t.st.Busy, !t.asked.IsZero() && time.Since(t.asked) < 2*time.Minute:
		phase = "working"
	case t.failed != "":
		phase = "failed"
	case t.lastText != "":
		phase = "finished"
	default:
		phase = "idle"
	}
	return phase, t.lastText
}

// Register makes t findable. If a thread with t's id is already open (two
// opens raced), that one is returned and the caller should stop t.
func Register(t *Thread) *Thread {
	registry.Lock()
	defer registry.Unlock()
	if old := registry.m[t.ID]; old != nil {
		return old
	}
	registry.m[t.ID] = t
	return t
}

// Find by thread id or current native session id.
func Find(id string) *Thread {
	registry.Lock()
	defer registry.Unlock()
	if t := registry.m[id]; t != nil {
		return t
	}
	for _, t := range registry.m {
		if t.State().Session == id {
			return t
		}
	}
	return nil
}

func List() []*Thread {
	registry.Lock()
	defer registry.Unlock()
	out := make([]*Thread, 0, len(registry.m))
	for _, t := range registry.m {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (t *Thread) State() protocol.State {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.st
}

// Messages: a copy of the thread's messages.
func (t *Thread) Messages() []protocol.Msg {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]protocol.Msg(nil), t.msgs...)
}

func (t *Thread) Clients() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.subs)
}

func (t *Thread) Ended() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.ended
}

// SetDup flags another CLI on the same session without counting as activity
// (so it doesn't keep an idle thread alive).
func (t *Thread) SetDup(dup bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.st.Dup = dup
	t.sync()
}

// ---- adapter → hub ----

// Do runs fn under the thread's lock, then publishes any change. fn may edit the
// state directly and call the methods below (Add … Fail); they expect the lock held.
func (t *Thread) Do(fn func(st *protocol.State)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.touched = time.Now()
	fn(&t.st)
	t.sync()
}

// Add a committed message. An assistant message replaces the draft on every client.
func (t *Thread) Add(m protocol.Msg) {
	if m.Role == "assistant" {
		t.draft = ""
		t.lastText = m.Text
	}
	t.msgs = append(t.msgs, m)
	if len(t.msgs) > 2*keepMsgs {
		t.msgs = append([]protocol.Msg(nil), t.msgs[len(t.msgs)-keepMsgs:]...)
	}
	t.broadcast(map[string]any{"type": "message", "message": m})
}

// AddOnce: Add, unless a message with m's ID is already there (an artifact
// card the adapter also derives from the agent's tool call).
func (t *Thread) AddOnce(m protocol.Msg) {
	for _, x := range t.msgs {
		if x.ID == m.ID {
			return
		}
	}
	t.Add(m)
}

// Reset replaces every message (Claude's /clear).
func (t *Thread) Reset(msgs []protocol.Msg) {
	t.msgs = msgs
	t.broadcast(map[string]any{"type": "messages", "messages": httpx.OrEmpty(msgs), "reset": true})
}

func (t *Thread) Delta(s string) {
	t.draft += s
	t.broadcast(map[string]any{"type": "draft", "delta": s})
}

func (t *Thread) ResetDraft() {
	t.draft = ""
	t.broadcast(map[string]any{"type": "draft", "reset": true})
}

func (t *Thread) TurnStart() {
	if !t.st.Busy {
		t.since = time.Now()
		t.failed = ""
	}
	t.st.Busy = true
	t.asked = time.Time{}
	t.st.Activity = text.OrDefault(t.st.Activity, "Working…")
}

func (t *Thread) TurnEnd() {
	if n := len(t.turns); n > 0 && t.turns[n-1].EndedAt == 0 {
		go t.finishTurn(t.turns[n-1]) // after the agent's last write
	}
	t.st.Busy, t.st.Activity, t.draft = false, "", ""
	for len(t.prompts) > 0 {
		t.ClosePrompt(t.prompts[0].ID)
	}
	t.goalTurnEnd()
}

func (t *Thread) AddPrompt(p *protocol.Prompt) {
	t.prompts = append(t.prompts, p)
	t.st.Activity = "Waiting for you"
	t.broadcast(map[string]any{"type": "prompt", "prompt": p})
	if t.alone {
		go t.decline(p)
	}
}

// SetUnattended: nobody watches this thread (a scheduled run).
func (t *Thread) SetUnattended() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.alone = true
}

// Unattended: the note an unattended run gets instead of an answer.
const Unattended = "No one is watching this run, so nothing can be approved or answered. Don't wait: decide for yourself where you can, skip what needs approval, and list what you skipped in your final reply."

// decline answers p for a user who isn't there.
func (t *Thread) decline(p *protocol.Prompt) {
	a := protocol.Answer{ID: p.ID, Choice: -1, Message: Unattended}
	if p.Kind == "question" {
		a.Answers = map[string][]string{}
		for _, q := range p.Questions {
			a.Answers[q.ID] = []string{Unattended}
		}
	}
	if t.Answer(a) == nil {
		t.Do(func(*protocol.State) {
			t.Add(protocol.Msg{ID: "alone-" + text.RandHex(4), Role: "system", Text: "Declined (unattended run): " + text.OneLine(p.Title+" "+p.Body)})
		})
	}
}

func (t *Thread) ClosePrompt(id string) *protocol.Prompt {
	for i, p := range t.prompts {
		if p.ID == id {
			t.prompts = append(t.prompts[:i], t.prompts[i+1:]...)
			t.broadcast(map[string]any{"type": "prompt_closed", "id": id})
			return p
		}
	}
	return nil
}

// ClosePromptWhere closes the first prompt matching (e.g. by adapter-private data).
func (t *Thread) ClosePromptWhere(match func(*protocol.Prompt) bool) {
	for _, p := range t.prompts {
		if match(p) {
			t.ClosePrompt(p.ID)
			return
		}
	}
}

// Fail shows an error and marks the current turn failed.
func (t *Thread) Fail(err string) {
	t.failed = err
	t.Add(protocol.Msg{ID: "err-" + text.RandHex(4), Role: "system", Text: err})
}

// End: the adapter's process is gone. Every client gets "ended".
func (t *Thread) End() {
	registry.Lock()
	if registry.m[t.ID] == t {
		delete(registry.m, t.ID)
	}
	registry.Unlock()
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.ended {
		return
	}
	t.ended = true
	t.broadcast(map[string]string{"type": "ended"})
	for s := range t.subs {
		close(s.ch)
		delete(t.subs, s)
	}
}

// ---- internals ----

func (t *Thread) sync() {
	b, _ := json.Marshal(t.st)
	if string(b) != t.lastSt {
		t.lastSt = string(b)
		t.broadcast(map[string]any{"type": "state", "state": t.st})
	}
	if r := t.runNow(); r != t.run {
		t.run = r
		publish(r)
	}
}

var tokenCountRe = regexp.MustCompile(` \(\d+ tokens\)`)

// runNow: the thread's summary for notifications and Live Activities. A turn
// that ends turns working/waiting into finished or failed; idle threads that
// never ran have no phase.
func (t *Thread) runNow() protocol.Run {
	r := protocol.Run{Thread: t.ID, Session: t.st.Session, Provider: t.st.Provider, Cwd: t.st.Cwd,
		Title: fmt.Sprintf("%s · %s", t.st.Provider.Name(), filepath.Base(t.st.Cwd)), StartedAt: t.since.UnixMilli()}
	switch {
	case len(t.prompts) > 0:
		p := t.prompts[0]
		r.Phase, r.Detail, r.Prompt, r.Kind = "waiting", text.OneLine(p.Title+" "+p.Body), p.ID, p.Kind
	case t.st.Busy:
		// The token count changes every few ms; Live Activities need a steadier line.
		r.Phase, r.Detail = "working", tokenCountRe.ReplaceAllString(text.OrDefault(t.st.Activity, "Working…"), "")
		for _, k := range t.st.Tasks {
			if k.Status == "in_progress" {
				r.Detail = k.Text
			}
		}
	case t.run.Phase == "working" || t.run.Phase == "waiting":
		r.EndedAt = time.Now().UnixMilli()
		if t.failed != "" {
			r.Phase, r.Detail = "failed", text.OneLine(t.failed)
		} else {
			r.Phase, r.Detail = "finished", text.OneLine(text.OrDefault(t.lastText, "Finished"))
		}
	default:
		keep := t.run // finished stays finished; never-run stays empty
		keep.Session, keep.Title = r.Session, r.Title
		return keep
	}
	r.Total = len(t.st.Tasks)
	for _, k := range t.st.Tasks {
		if k.Status == "completed" {
			r.Done++
		}
	}
	return r
}

// broadcast: callers hold t.mu. A client whose buffer is full is dropped; it
// reconnects and gets a fresh snapshot.
func (t *Thread) broadcast(v any) {
	b, _ := json.Marshal(v)
	for s := range t.subs {
		select {
		case s.ch <- b:
		default:
			close(s.ch)
			delete(t.subs, s)
		}
	}
}

func (t *Thread) subscribe() (*sub, []byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	s := &sub{ch: make(chan []byte, 1024)}
	snap, _ := json.Marshal(map[string]any{"type": "snapshot", "state": t.st, "messages": httpx.OrEmpty(t.msgs[max(0, len(t.msgs)-keepMsgs):]),
		"draft": t.draft, "prompts": httpx.OrEmpty(t.prompts)})
	if t.ended {
		close(s.ch)
	} else {
		t.subs[s] = true
	}
	t.touched = time.Now()
	return s, snap
}

func (t *Thread) unsubscribe(s *sub) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.subs[s] {
		delete(t.subs, s)
		close(s.ch)
	}
	t.touched = time.Now()
}

// ---- clients → hub ----

// Send starts (or queues/steers) a turn. A new turn first checkpoints the
// working tree, before the agent can touch it.
func (t *Thread) Send(msg string, files []string) error {
	if strings.TrimSpace(msg) == "" && len(files) == 0 {
		return errors.New("empty message")
	}
	for _, f := range files {
		if !uploads.Valid(f) {
			return errors.New("attachments must come from /uploads")
		}
	}
	t.mu.Lock()
	t.touched = time.Now()
	busy, cwd := t.st.Busy, t.st.Cwd
	if t.prefix != "" {
		msg = strings.TrimSpace(t.prefix + "\n\n" + msg)
		t.prefix = ""
	}
	t.asked = time.Now()
	t.mu.Unlock()
	if !busy {
		if cp := checkpoint.Begin(cwd, msg); cp != nil {
			t.mu.Lock()
			cp.N = 1
			if n := len(t.turns); n > 0 {
				cp.N = t.turns[n-1].N + 1
			}
			t.turns = append(t.turns, cp)
			if len(t.turns) > maxTurns {
				t.turns = t.turns[1:]
			}
			t.mu.Unlock()
		}
	}
	return t.rt.Send(msg, files)
}

// Answer: first answer from any client wins; the others see prompt_closed.
func (t *Thread) Answer(a protocol.Answer) error {
	t.mu.Lock()
	p := t.ClosePrompt(a.ID)
	if p != nil {
		t.st.Activity = "Working…"
		t.sync()
	}
	t.mu.Unlock()
	if p == nil {
		return errors.New("already answered")
	}
	return t.rt.Answer(p, a)
}

func (t *Thread) SetMode(m string) error {
	if !protocol.ValidMode(m) {
		return fmt.Errorf("unknown mode %q", m)
	}
	return t.rt.SetMode(m)
}

// ReapIdle stops threads nobody watches that aren't working; reopening resumes them.
func ReapIdle() {
	for range time.Tick(time.Minute) {
		for _, t := range List() {
			t.mu.Lock()
			idle := len(t.subs) == 0 && !t.st.Busy && len(t.prompts) == 0 && time.Since(t.touched) > idleStop
			t.mu.Unlock()
			if idle {
				t.rt.Stop()
			}
		}
	}
}

// ---- turn checkpoints ----

func (t *Thread) finishTurn(cp *checkpoint.Checkpoint) {
	tree, err := checkpoint.Snapshot(cp.Root)
	if err != nil {
		return
	}
	n := checkpoint.Changed(cp.Root, cp.Start, tree)
	t.mu.Lock()
	cp.End, cp.Files, cp.EndedAt = tree, n, time.Now().UnixMilli()
	t.mu.Unlock()
}

func (t *Thread) turn(n int) *checkpoint.Checkpoint {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, cp := range t.turns {
		if cp.N == n {
			return cp
		}
	}
	return nil
}

// Turns, newest first.
func (t *Thread) Turns() []protocol.Turn {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := []protocol.Turn{}
	for i := len(t.turns) - 1; i >= 0; i-- {
		out = append(out, t.turns[i].Turn)
	}
	return out
}

// TurnDiff: turn n's changes (a running turn: so far).
func (t *Thread) TurnDiff(n int) (string, error) {
	cp := t.turn(n)
	if cp == nil {
		return "", errors.New("no such turn")
	}
	t.mu.Lock()
	end := cp.End
	t.mu.Unlock()
	if end == "" {
		var err error
		if end, err = checkpoint.Snapshot(cp.Root); err != nil {
			return "", err
		}
	}
	return checkpoint.Diff(cp.Root, cp.Start, end)
}

// RevertTo puts the files back to how they were before turn n (undoing it and
// every later turn). Refused while the agent works.
func (t *Thread) RevertTo(n int) error {
	if t.State().Busy {
		return errors.New("stop the agent first")
	}
	cp := t.turn(n)
	if cp == nil {
		return errors.New("no such turn")
	}
	now, err := checkpoint.Snapshot(cp.Root)
	if err == nil {
		err = checkpoint.Restore(cp.Root, cp.Start, now)
	}
	if err != nil {
		return err
	}
	t.Do(func(*protocol.State) {
		t.Add(protocol.Msg{ID: "revert-" + text.RandHex(4), Role: "system", Text: fmt.Sprintf("Reverted files to before turn %d: %s", cp.N, cp.Prompt)})
	})
	return nil
}

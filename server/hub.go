package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Thread hub: one per open conversation, whatever the provider. The runtime
// underneath (claude.go, codex.go) turns provider events into hub calls; the hub
// keeps the state every client needs and fans frames out to all of them. Input
// from any client goes to the single runtime, so phones (and anything else
// attached) always see the same conversation.

// Runtime is the provider side of one open thread.
type Runtime interface {
	Send(text string) error
	Interrupt() error
	Answer(p *Prompt, a Answer) error
	SetMode(mode string) error
	SetModel(model string) error
	Stop()
}

const (
	keepMsgs = 300
	idleStop = 30 * time.Minute
)

type Thread struct {
	ID string // native session id it was opened with; stable even after /clear
	rt Runtime

	mu       sync.Mutex
	st       State
	lastSt   string
	msgs     []Msg
	draft    string
	prompts  []*Prompt
	subs     map[*sub]bool
	touched  time.Time
	since    time.Time // current turn start
	lastText string    // last assistant text: the "finished" detail
	failed   string    // error of the current turn, if any
	run      Run       // last published summary
	ended    bool
}

type sub struct{ ch chan []byte }

var threads = struct {
	sync.Mutex
	m map[string]*Thread
}{m: map[string]*Thread{}}

func newThread(id string, st State) *Thread {
	return &Thread{ID: id, st: st, subs: map[*sub]bool{}, touched: time.Now()}
}

func register(t *Thread) {
	threads.Lock()
	threads.m[t.ID] = t
	threads.Unlock()
}

// findThread by thread id or current native session id.
func findThread(id string) *Thread {
	threads.Lock()
	defer threads.Unlock()
	return findThreadLocked(id)
}

func findThreadLocked(id string) *Thread {
	if t := threads.m[id]; t != nil {
		return t
	}
	for _, t := range threads.m {
		if t.State().Session == id {
			return t
		}
	}
	return nil
}

func listThreads() []*Thread {
	threads.Lock()
	defer threads.Unlock()
	out := make([]*Thread, 0, len(threads.m))
	for _, t := range threads.m {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (t *Thread) State() State {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.st
}

func (t *Thread) Clients() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.subs)
}

// ---- runtime → hub (do holds the lock; everything below it expects it held) ----

// do runs fn under the hub lock, then publishes any state change.
func (t *Thread) do(fn func()) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.touched = time.Now()
	fn()
	t.syncState()
}

func (t *Thread) add(m Msg) {
	if m.Role == "assistant" {
		t.draft = "" // the committed text replaces the draft on every client
		t.lastText = m.Text
	}
	t.msgs = append(t.msgs, m)
	if len(t.msgs) > 2*keepMsgs {
		t.msgs = append([]Msg(nil), t.msgs[len(t.msgs)-keepMsgs:]...)
	}
	t.broadcast(map[string]any{"type": "message", "message": m})
}

func (t *Thread) reset(msgs []Msg) {
	t.msgs = msgs
	t.broadcast(map[string]any{"type": "messages", "messages": orEmpty(msgs), "reset": true})
}

func (t *Thread) delta(s string) {
	t.draft += s
	t.broadcast(map[string]any{"type": "draft", "delta": s})
}

func (t *Thread) resetDraft() {
	t.draft = ""
	t.broadcast(map[string]any{"type": "draft", "reset": true})
}

func (t *Thread) turnStart() {
	if !t.st.Busy {
		t.since = time.Now()
		t.failed = ""
	}
	t.st.Busy = true
	t.st.Activity = orDefault(t.st.Activity, "Working…")
}

func (t *Thread) turnEnd() {
	t.st.Busy, t.st.Activity, t.draft = false, "", ""
	for len(t.prompts) > 0 {
		t.closePrompt(t.prompts[0].ID)
	}
}

func (t *Thread) addPrompt(p *Prompt) {
	t.prompts = append(t.prompts, p)
	t.st.Activity = "Waiting for you"
	t.broadcast(map[string]any{"type": "prompt", "prompt": p})
}

func (t *Thread) closePrompt(id string) *Prompt {
	for i, p := range t.prompts {
		if p.ID == id {
			t.prompts = append(t.prompts[:i], t.prompts[i+1:]...)
			t.broadcast(map[string]any{"type": "prompt_closed", "id": id})
			return p
		}
	}
	return nil
}

func (t *Thread) fail(err string) {
	t.failed = err
	t.add(Msg{ID: "err-" + randHex(4), Role: "system", Text: err})
}

// end: the runtime's process is gone. Every client gets "ended".
func (t *Thread) end() {
	threads.Lock()
	if threads.m[t.ID] == t {
		delete(threads.m, t.ID)
	}
	threads.Unlock()
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

func (t *Thread) syncState() {
	b, _ := json.Marshal(t.st)
	if string(b) != t.lastSt {
		t.lastSt = string(b)
		t.broadcast(map[string]any{"type": "state", "state": t.st})
	}
	if r := t.runNow(); r != t.run {
		t.run = r
		publishRun(r)
	}
}

// runNow: the thread's summary for notifications and Live Activities. A turn
// that ends turns working/waiting into finished or failed; idle threads that
// never ran have no phase.
func (t *Thread) runNow() Run {
	r := Run{Thread: t.ID, Session: t.st.Session, Provider: t.st.Provider, Cwd: t.st.Cwd,
		Title: fmt.Sprintf("%s · %s", providerName(t.st.Provider), baseName(t.st.Cwd)), StartedAt: t.since.UnixMilli()}
	switch {
	case len(t.prompts) > 0:
		p := t.prompts[0]
		r.Phase, r.Detail = "waiting", oneLine(p.Title+" "+p.Body)
	case t.st.Busy:
		// The token count changes every few ms; Live Activities need a steadier line.
		r.Phase, r.Detail = "working", tokenCountRe.ReplaceAllString(orDefault(t.st.Activity, "Working…"), "")
	case t.run.Phase == "working" || t.run.Phase == "waiting":
		r.EndedAt = time.Now().UnixMilli()
		if t.failed != "" {
			r.Phase, r.Detail = "failed", oneLine(t.failed)
		} else {
			r.Phase, r.Detail = "finished", oneLine(orDefault(t.lastText, "Finished"))
		}
	default:
		r = t.run // unchanged (finished stays finished; never-run stays empty)
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

// ---- clients → hub ----

func (t *Thread) subscribe() (*sub, []byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	s := &sub{ch: make(chan []byte, 1024)}
	snap, _ := json.Marshal(map[string]any{"type": "snapshot", "state": t.st, "messages": orEmpty(t.msgs[max(0, len(t.msgs)-keepMsgs):]),
		"draft": t.draft, "prompts": orEmpty(t.prompts)})
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

func (t *Thread) Send(text string) error {
	if len(text) == 0 {
		return errors.New("empty message")
	}
	t.mu.Lock()
	t.touched = time.Now()
	t.mu.Unlock()
	return t.rt.Send(text)
}

// Answer: first answer from any client wins; the others see prompt_closed.
func (t *Thread) Answer(a Answer) error {
	t.mu.Lock()
	p := t.closePrompt(a.ID)
	if p != nil {
		t.st.Activity = "Working…"
		t.syncState()
	}
	t.mu.Unlock()
	if p == nil {
		return errors.New("already answered")
	}
	return t.rt.Answer(p, a)
}

func (t *Thread) SetMode(m string) error {
	if !validMode(m) {
		return fmt.Errorf("unknown mode %q", m)
	}
	return t.rt.SetMode(m)
}

// reapIdle stops threads nobody watches that aren't working; reopening resumes them.
func reapIdle() {
	for range time.Tick(time.Minute) {
		for _, t := range listThreads() {
			t.mu.Lock()
			idle := len(t.subs) == 0 && !t.st.Busy && len(t.prompts) == 0 && time.Since(t.touched) > idleStop
			t.mu.Unlock()
			if idle {
				t.rt.Stop()
			}
		}
	}
}

var tokenCountRe = regexp.MustCompile(` \(\d+ tokens\)`)

func validMode(m string) bool {
	return m == ModeAsk || m == ModeEdits || m == ModePlan || m == ModeFull
}

// ---- WS /threads/{id}/events ----

func (s *server) threadEvents(w http.ResponseWriter, r *http.Request) {
	t := findThread(r.PathValue("id"))
	if t == nil {
		http.Error(w, "no such open thread", http.StatusNotFound)
		return
	}
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true}) // bearer auth, not cookies
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(4 << 20)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	sb, snap := t.subscribe()
	defer t.unsubscribe(sb)
	errs := make(chan []byte, 8)
	go func() {
		defer cancel()
		for {
			_, data, err := c.Read(ctx)
			if err != nil {
				return
			}
			var f ClientFrame
			if json.Unmarshal(data, &f) != nil {
				continue
			}
			var err2 error
			switch f.Type {
			case "send":
				err2 = t.Send(f.Text)
			case "answer":
				err2 = t.Answer(f.Answer)
			case "interrupt":
				err2 = t.rt.Interrupt()
			case "mode":
				err2 = t.SetMode(f.Mode)
			case "model":
				err2 = t.rt.SetModel(f.Model)
			default:
				err2 = fmt.Errorf("unknown frame %q", f.Type)
			}
			if err2 != nil {
				b, _ := json.Marshal(map[string]string{"type": "error", "error": err2.Error()})
				select {
				case errs <- b:
				default:
				}
			}
		}
	}()

	if c.Write(ctx, websocket.MessageText, snap) != nil {
		return
	}
	// Pings keep idle sockets alive through tunnels and mobile NATs.
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		var b []byte
		select {
		case <-ctx.Done():
			return
		case <-ping.C:
			pctx, pc := context.WithTimeout(ctx, 10*time.Second)
			err := c.Ping(pctx)
			pc()
			if err != nil {
				return
			}
			continue
		case b = <-errs:
		case f, ok := <-sb.ch:
			if !ok {
				c.Close(websocket.StatusNormalClosure, "")
				return
			}
			b = f
		}
		if c.Write(ctx, websocket.MessageText, b) != nil {
			return
		}
	}
}

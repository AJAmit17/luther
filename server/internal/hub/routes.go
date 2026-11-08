package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

// Routes: everything about threads that are already open (opening one needs
// the agent adapters, so that lives in the api package).
func Routes(mux *http.ServeMux, wrap httpx.Wrap) {
	mux.HandleFunc("GET /threads/{id}/events", wrap(open(events)))
	mux.HandleFunc("DELETE /threads/{id}", wrap(open(func(w http.ResponseWriter, r *http.Request, t *Thread) { t.rt.Stop() })))
	mux.HandleFunc("POST /threads/{id}/interrupt", wrap(open(func(w http.ResponseWriter, r *http.Request, t *Thread) {
		t.StopGoal()
		if err := t.rt.Interrupt(); err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
		}
	})))
	mux.HandleFunc("POST /threads/{id}/goal", wrap(open(func(w http.ResponseWriter, r *http.Request, t *Thread) {
		var g struct {
			Objective string `json:"objective"`
			Rounds    int    `json:"rounds"`
		}
		if !httpx.ReadJSON(w, r, &g) {
			return
		}
		if err := t.SetGoal(g.Objective, g.Rounds); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
		}
	})))
	mux.HandleFunc("DELETE /threads/{id}/goal", wrap(open(func(w http.ResponseWriter, r *http.Request, t *Thread) { t.StopGoal() })))
	mux.HandleFunc("POST /threads/{id}/answer", wrap(open(func(w http.ResponseWriter, r *http.Request, t *Thread) {
		var a protocol.Answer
		if !httpx.ReadJSON(w, r, &a) {
			return
		}
		if err := t.Answer(a); err != nil {
			http.Error(w, err.Error(), http.StatusConflict) // already answered elsewhere
		}
	})))
	mux.HandleFunc("GET /threads/{id}/turns", wrap(open(func(w http.ResponseWriter, r *http.Request, t *Thread) { httpx.WriteJSON(w, t.Turns()) })))
	mux.HandleFunc("GET /threads/{id}/turns/{n}/diff", wrap(open(func(w http.ResponseWriter, r *http.Request, t *Thread) {
		n, _ := strconv.Atoi(r.PathValue("n"))
		d, err := t.TurnDiff(n)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte(d))
	})))
	mux.HandleFunc("POST /threads/{id}/turns/{n}/revert", wrap(open(func(w http.ResponseWriter, r *http.Request, t *Thread) {
		n, _ := strconv.Atoi(r.PathValue("n"))
		if err := t.RevertTo(n); err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
		}
	})))
	mux.HandleFunc("GET /events", wrap(feedSocket))
	mux.HandleFunc("GET /runs", wrap(func(w http.ResponseWriter, r *http.Request) { httpx.WriteJSON(w, Runs()) }))
}

// open resolves {id} to an open thread or answers 404.
func open(h func(http.ResponseWriter, *http.Request, *Thread)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		t := Find(r.PathValue("id"))
		if t == nil {
			http.Error(w, "no such open thread", http.StatusNotFound)
			return
		}
		h(w, r, t)
	}
}

// events: WS /threads/{id}/events — snapshot, then every frame; in: ClientFrame.
func events(w http.ResponseWriter, r *http.Request, t *Thread) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true}) // origin check off: bearer auth, never cookies
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
			var f protocol.ClientFrame
			if json.Unmarshal(data, &f) != nil {
				continue
			}
			var err2 error
			switch f.Type {
			case "send":
				err2 = t.Send(f.Text, f.Files)
			case "answer":
				err2 = t.Answer(f.Answer)
			case "interrupt":
				t.StopGoal() // Stop means stop, not "judge and go on"
				err2 = t.rt.Interrupt()
			case "goal":
				err2 = t.SetGoal(f.Text, f.Rounds)
			case "goal_stop":
				t.StopGoal()
			case "compact":
				err2 = t.Compact()
			case "mode":
				err2 = t.SetMode(f.Mode)
			case "model":
				err2 = t.rt.SetModel(f.Model)
			case "effort":
				err2 = t.rt.SetEffort(f.Effort)
			case "fast":
				err2 = t.rt.SetFast(f.Fast)
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
	pump(ctx, c, sb.ch, errs)
}

// pump writes frames until the channel closes or the socket dies; pings keep
// idle sockets alive through tunnels and mobile NATs.
func pump(ctx context.Context, c *websocket.Conn, ch <-chan []byte, extra <-chan []byte) {
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
		case b = <-extra:
		case f, ok := <-ch:
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

// ---- run feed: WS /events, one socket per phone, a Run for every thread on
// every change. The app turns them into local notifications and Live
// Activities. It reaches only a phone whose app is running (iOS suspends a
// backgrounded app); GET /runs serves the app's background refresh. ----

var feed = struct {
	sync.Mutex
	subs map[chan []byte]bool
}{subs: map[chan []byte]bool{}}

// publish: callers hold a thread lock; never blocks.
func publish(r protocol.Run) {
	b, _ := json.Marshal(map[string]any{"type": "run", "run": r})
	feed.Lock()
	defer feed.Unlock()
	for ch := range feed.subs {
		select {
		case ch <- b:
		default: // slow phone: drop the event, not the socket
		}
	}
}

// Runs: the latest Run of every open thread that has run.
func Runs() []protocol.Run {
	out := []protocol.Run{}
	for _, t := range List() {
		t.mu.Lock()
		if t.run.Phase != "" {
			out = append(out, t.run)
		}
		t.mu.Unlock()
	}
	return out
}

func feedSocket(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true}) // origin check off: bearer auth, never cookies
	if err != nil {
		return
	}
	defer c.CloseNow()
	ch := make(chan []byte, 64)
	feed.Lock()
	feed.subs[ch] = true
	feed.Unlock()
	defer func() {
		feed.Lock()
		delete(feed.subs, ch)
		feed.Unlock()
	}()
	pump(c.CloseRead(r.Context()), c, ch, nil) // the feed is one-way
}

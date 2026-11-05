package main

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Feed: WS /events — one socket per phone, carrying a Run for every thread
// on every change. The app turns them into local notifications and Live
// Activities. No third-party push service: it only reaches a phone whose
// app is running (iOS suspends a backgrounded app after ~30 s; only APNs can
// wake a closed app).

var feed = struct {
	sync.Mutex
	subs map[chan []byte]bool
}{subs: map[chan []byte]bool{}}

// publishRun: hub callers hold a thread lock; this never blocks.
func publishRun(r Run) {
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

// runs: GET /runs → the latest Run of every open thread (background refresh).
func (s *server) runs(w http.ResponseWriter, r *http.Request) {
	out := []Run{}
	for _, t := range listThreads() {
		t.mu.Lock()
		if t.run.Phase != "" {
			out = append(out, t.run)
		}
		t.mu.Unlock()
	}
	writeJSON(w, out)
}

func (s *server) events(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true}) // bearer auth, not cookies
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
	ctx := c.CloseRead(r.Context()) // the feed is one-way
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case b := <-ch:
			if c.Write(ctx, websocket.MessageText, b) != nil {
				return
			}
		case <-ping.C:
			pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := c.Ping(pctx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

func providerName(p Provider) string {
	switch p {
	case Claude:
		return "Claude"
	case Codex:
		return "Codex"
	}
	return string(p)
}

func baseName(p string) string { return filepath.Base(p) }

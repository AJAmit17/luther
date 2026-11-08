// Package restore: threads that were working when Luther stopped come back.
// Every few seconds (and on a clean stop) the threads that are working or
// waiting on you are written to ~/.luther/running.json; at start, each one
// younger than two hours is resumed with its agent's own resume and told to
// carry on. A thread that was idle stays closed: opening it from the phone
// resumes it as always.
package restore

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
)

const (
	every  = 5 * time.Second
	maxAge = 2 * time.Hour
	// Carry is sent to a resumed thread.
	Carry = "Luther restarted while you were working on this, so your last turn was cut off. Check what you had done and carry on where you left off."
)

// Entry: one thread to bring back.
type Entry struct {
	Provider protocol.Provider `json:"provider"`
	Session  string            `json:"session"`
	Cwd      string            `json:"cwd"`
	Mode     string            `json:"mode,omitempty"`
	Model    string            `json:"model,omitempty"`
	Saved    int64             `json:"saved"`
}

func file() string { return filepath.Join(config.Dir(), "running.json") }

// Running: the threads working or waiting on you now.
func Running() []Entry {
	out := []Entry{}
	for _, t := range hub.List() {
		phase, _ := t.Status()
		if phase != "working" && phase != "waiting" {
			continue
		}
		st := t.State()
		out = append(out, Entry{Provider: st.Provider, Session: st.Session, Cwd: st.Cwd, Mode: st.Mode, Model: st.Model})
	}
	return out
}

// Save writes what Running says, stamped now.
func Save() error { return write(Running()) }

func write(list []Entry) error {
	now := time.Now().UnixMilli()
	for i := range list {
		list[i].Saved = now
	}
	b, _ := json.Marshal(list)
	os.MkdirAll(config.Dir(), 0o700)
	tmp := file() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, file())
}

// Keep saves every few seconds, so a crash loses at most that much.
func Keep() {
	last, wrote := "", time.Time{}
	for range time.Tick(every) {
		list := Running()
		b, _ := json.Marshal(list) // unstamped: equal when nothing changed
		// Rewritten now and then anyway, so a long turn's stamp stays fresh.
		if s := string(b); s != last || time.Since(wrote) > 10*time.Minute {
			last, wrote = s, time.Now()
			if err := write(list); err != nil {
				log.Printf("save running threads: %v", err)
			}
		}
	}
}

// Opener: the api package's open.
type Opener func(protocol.OpenReq) (*hub.Thread, int, error)

// Resume brings back what the last run left in running.json, then forgets it.
func Resume(open Opener) {
	b, err := os.ReadFile(file())
	if err != nil {
		return
	}
	os.Remove(file())
	var list []Entry
	if json.Unmarshal(b, &list) != nil {
		return
	}
	for _, e := range Due(list, time.Now()) {
		t, _, err := open(protocol.OpenReq{Provider: e.Provider, Cwd: e.Cwd, Resume: e.Session, Mode: e.Mode, Model: e.Model})
		if err != nil {
			log.Printf("resume %s %s: %v", e.Provider, text.Clip(e.Session, 8), err)
			continue
		}
		t.Do(func(*protocol.State) {
			t.Add(protocol.Msg{ID: "restored-" + text.RandHex(4), Role: "system", Text: "Resumed after Luther restarted"})
		})
		if err := t.Send(Carry, nil); err != nil {
			log.Printf("resume %s: %v", text.Clip(e.Session, 8), err)
		}
	}
}

// Due: the entries worth resuming at now (young enough, one per session).
func Due(list []Entry, now time.Time) []Entry {
	seen := map[string]bool{}
	out := []Entry{}
	for _, e := range list {
		if e.Session == "" || e.Cwd == "" || seen[e.Session] || now.Sub(time.UnixMilli(e.Saved)) > maxAge {
			continue
		}
		seen[e.Session] = true
		out = append(out, e)
	}
	return out
}

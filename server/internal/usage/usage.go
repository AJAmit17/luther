// Package usage: each agent's plan usage (rate-limit windows), as last
// reported. Kept in ~/.luther/usage.json so it survives restarts — Claude only
// reports during a turn.
package usage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

var store = struct {
	sync.Mutex
	m map[string]protocol.Limits // by key()
}{}

// key: one entry per provider and account ("claude", "claude/Desktop app").
func key(l protocol.Limits) string {
	if l.Account == "" {
		return string(l.Provider)
	}
	return string(l.Provider) + "/" + l.Account
}

func file() string { return filepath.Join(config.Dir(), "usage.json") }

// load: store lock held.
func load() {
	if store.m == nil {
		store.m = map[string]protocol.Limits{}
		if b, err := os.ReadFile(file()); err == nil {
			json.Unmarshal(b, &store.m)
		}
	}
}

// Set records l as its agent's (and account's) latest; an empty window list
// is ignored. Updated defaults to now.
func Set(l protocol.Limits) {
	if len(l.Windows) == 0 {
		return
	}
	if l.Updated == 0 {
		l.Updated = time.Now().UnixMilli()
	}
	store.Lock()
	defer store.Unlock()
	load()
	store.m[key(l)] = l
	b, _ := json.MarshalIndent(store.m, "", "  ")
	os.MkdirAll(config.Dir(), 0o700)
	os.WriteFile(file(), b, 0o600)
}

// All: every agent's latest, by provider then account (the CLI login first).
func All() []protocol.Limits {
	store.Lock()
	defer store.Unlock()
	load()
	out := []protocol.Limits{}
	for _, l := range store.m {
		out = append(out, l)
	}
	sort.Slice(out, func(i, j int) bool { return key(out[i]) < key(out[j]) })
	return out
}

// Label: "5 hours", "7 days" for a window length in minutes.
func Label(mins int) string {
	switch {
	case mins <= 0:
		return "Window"
	case mins%1440 == 0:
		return plural(mins/1440, "day")
	case mins%60 == 0:
		return plural(mins/60, "hour")
	}
	return plural(mins, "minute")
}

func plural(n int, unit string) string {
	if n == 1 {
		return "1 " + unit
	}
	return itoa(n) + " " + unit + "s"
}

func itoa(n int) string { return strconv.Itoa(n) }

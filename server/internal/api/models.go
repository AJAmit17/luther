package api

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/AJAmit17/luther/server/internal/acp"
	"github.com/AJAmit17/luther/server/internal/claude"
	"github.com/AJAmit17/luther/server/internal/codex"
	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

// Each agent's models, as the agent itself lists them, kept in
// ~/.luther/models.json: answered at once (the new-thread sheet needs them
// before any session), refreshed in the background once older than modelsTTL.
const modelsTTL = 6 * time.Hour

type modelList struct {
	At     time.Time        `json:"at"`
	Models []protocol.Model `json:"models"`
}

var kept = struct {
	sync.Mutex
	m       map[protocol.Provider]modelList
	loading map[protocol.Provider]chan struct{}
}{loading: map[protocol.Provider]chan struct{}{}}

func modelsFile() string { return filepath.Join(config.Dir(), "models.json") }

// listModels asks the agent (seconds: it may start a process).
func listModels(p protocol.Provider) []protocol.Model {
	switch p {
	case protocol.Claude:
		ms, err := claude.Models()
		if err != nil {
			log.Print(err)
		}
		return ms
	case protocol.Codex:
		return codex.Models()
	}
	return acp.Models(p)
}

// refresh loads p's models once at a time; wait blocks until done.
func refresh(p protocol.Provider, wait bool) {
	kept.Lock()
	ch, busy := kept.loading[p]
	if !busy {
		ch = make(chan struct{})
		kept.loading[p] = ch
		go func() {
			ms := listModels(p)
			kept.Lock()
			if ms != nil { // keep the last good list over a failed ask
				kept.m[p] = modelList{At: time.Now(), Models: ms}
				b, _ := json.Marshal(kept.m)
				os.WriteFile(modelsFile(), b, 0o600)
			}
			delete(kept.loading, p)
			kept.Unlock()
			close(ch)
		}()
	}
	kept.Unlock()
	if wait {
		<-ch
	}
}

func loadKept() {
	kept.Lock()
	defer kept.Unlock()
	if kept.m != nil {
		return
	}
	kept.m = map[protocol.Provider]modelList{}
	if b, err := os.ReadFile(modelsFile()); err == nil {
		json.Unmarshal(b, &kept.m)
	}
}

// warmModels: at start, refresh every installed agent's list.
func warmModels() {
	loadKept()
	refresh(protocol.Claude, false)
	refresh(protocol.Codex, false)
	for _, a := range acp.Agents {
		if a.Bin() != "" {
			refresh(a.ID, false)
		}
	}
}

// models: GET /models?provider= → [Model].
func models(w http.ResponseWriter, r *http.Request) {
	p := protocol.Provider(r.URL.Query().Get("provider"))
	loadKept()
	kept.Lock()
	l, ok := kept.m[p]
	kept.Unlock()
	switch {
	case !ok:
		refresh(p, true)
		kept.Lock()
		l = kept.m[p]
		kept.Unlock()
	case time.Since(l.At) > modelsTTL:
		refresh(p, false)
	}
	httpx.WriteJSON(w, httpx.OrEmpty(l.Models))
}

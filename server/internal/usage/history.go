package usage

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

type entry struct {
	ID       string            `json:"id"`
	Provider protocol.Provider `json:"provider"`
	Model    string            `json:"model"`
	At       time.Time         `json:"at"`
	Usage    protocol.Usage    `json:"usage"`
}

type cached struct {
	Mod     time.Time
	Size    int64
	Entries []entry
}

var history = struct {
	sync.Mutex
	Files map[string]cached
}{Files: map[string]cached{}}

var ledgerMu sync.Mutex

func Routes(mux *http.ServeMux, wrap httpx.Wrap) {
	mux.HandleFunc("GET /usage/history", wrap(func(w http.ResponseWriter, r *http.Request) {
		days := 30
		switch r.URL.Query().Get("days") {
		case "7":
			days = 7
		case "", "30":
		case "90":
			days = 90
		default:
			http.Error(w, "days must be 7, 30 or 90", http.StatusBadRequest)
			return
		}
		httpx.WriteJSON(w, History(days, time.Now()))
	}))
}

func ledgerFile() string { return filepath.Join(config.Dir(), "tokens.json") }

func readLedger() (map[string]entry, error) {
	m := map[string]entry{}
	b, err := os.ReadFile(ledgerFile())
	if os.IsNotExist(err) {
		return m, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	if m == nil {
		m = map[string]entry{}
	}
	return m, nil
}

func Record(id string, provider protocol.Provider, model string, at time.Time, u protocol.Usage) error {
	ledgerMu.Lock()
	defer ledgerMu.Unlock()
	m, err := readLedger()
	if err != nil {
		return err
	}
	m[id] = entry{ID: id, Provider: provider, Model: model, At: at, Usage: u}
	for key, e := range m {
		if e.At.Before(at.AddDate(-1, 0, 0)) {
			delete(m, key)
		}
	}
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(config.Dir(), 0o700); err != nil {
		return err
	}
	tmp := ledgerFile() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, ledgerFile())
}

func History(days int, now time.Time) protocol.UsageHistory {
	history.Lock()
	defer history.Unlock()
	days = max(1, min(90, days))
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, 1-days)
	out := protocol.UsageHistory{
		Days: []protocol.UsageDay{}, Breakdown: []protocol.UsageBreakdown{}, Updated: now.UnixMilli(),
		Notes: []string{
			"Days use the Mac's local time. Claude and Codex include readable local transcripts, including terminal sessions and Claude subagents.",
			"Other agents include only token usage explicitly reported by prompts run through Luther, from this update onward. Context size is not token burn.",
			"Costs are reported amounts only, not estimates or subscription charges; missing costs are unavailable. Input excludes cache reads and writes.",
		},
	}
	byDay := map[string]int{}
	for i := 0; i < days; i++ {
		date := start.AddDate(0, 0, i).Format("2006-01-02")
		byDay[date] = i
		out.Days = append(out.Days, protocol.UsageDay{Date: date})
	}
	entries := map[string]entry{}
	seen := map[string]bool{}
	for _, source := range []struct {
		Root     string
		Provider protocol.Provider
	}{
		{filepath.Join(paths.Home, ".claude", "projects"), protocol.Claude},
		{filepath.Join(paths.Home, ".codex", "sessions"), protocol.Codex},
		{filepath.Join(paths.Home, ".codex", "archived_sessions"), protocol.Codex},
	} {
		err := filepath.WalkDir(source.Root, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || !strings.HasSuffix(p, ".jsonl") {
				return nil
			}
			fi, err := d.Info()
			if err != nil {
				return err
			}
			seen[p] = true
			c, ok := history.Files[p]
			if !ok || !c.Mod.Equal(fi.ModTime()) || c.Size != fi.Size() {
				f, err := os.Open(p)
				if err != nil {
					return err
				}
				c = cached{Mod: fi.ModTime(), Size: fi.Size(), Entries: parse(f, source.Provider, p)}
				f.Close()
				history.Files[p] = c
			}
			for _, e := range c.Entries {
				if prev, ok := entries[e.ID]; ok {
					e.Usage = maximum(prev.Usage, e.Usage)
				}
				entries[e.ID] = e
			}
			return nil
		})
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			out.Notes = append(out.Notes, string(source.Provider)+": some transcripts could not be read: "+err.Error())
		}
	}
	for p := range history.Files {
		if !seen[p] {
			delete(history.Files, p)
		}
	}
	ledgerMu.Lock()
	m, ledgerErr := readLedger()
	ledgerMu.Unlock()
	if ledgerErr == nil {
		for id, e := range m {
			entries[id] = e
		}
	} else {
		out.Notes = append(out.Notes, "Luther's reported-usage store could not be read: "+ledgerErr.Error())
	}
	breakdown := map[string]protocol.UsageBreakdown{}
	for _, e := range entries {
		if e.At.Before(start) || e.At.After(now) {
			continue
		}
		i, ok := byDay[e.At.In(now.Location()).Format("2006-01-02")]
		if !ok {
			continue
		}
		add(&out.Days[i].Usage, e.Usage)
		add(&out.Total, e.Usage)
		key := string(e.Provider) + "/" + e.Model
		b := breakdown[key]
		b.Provider, b.Model = e.Provider, e.Model
		add(&b.Usage, e.Usage)
		breakdown[key] = b
	}
	for _, b := range breakdown {
		out.Breakdown = append(out.Breakdown, b)
	}
	sort.Slice(out.Breakdown, func(i, j int) bool {
		a, b := out.Breakdown[i], out.Breakdown[j]
		if a.Provider != b.Provider {
			return a.Provider < b.Provider
		}
		return a.Model < b.Model
	})
	return out
}

func add(a *protocol.Usage, b protocol.Usage) {
	a.InputTokens += b.InputTokens
	a.OutputTokens += b.OutputTokens
	a.CacheReadTokens += b.CacheReadTokens
	a.CacheWriteTokens += b.CacheWriteTokens
	a.CostUSD += b.CostUSD
	a.CostReported = a.CostReported || b.CostReported
}

func maximum(a, b protocol.Usage) protocol.Usage {
	return protocol.Usage{InputTokens: max(a.InputTokens, b.InputTokens), OutputTokens: max(a.OutputTokens, b.OutputTokens),
		CacheReadTokens: max(a.CacheReadTokens, b.CacheReadTokens), CacheWriteTokens: max(a.CacheWriteTokens, b.CacheWriteTokens),
		CostUSD: max(a.CostUSD, b.CostUSD), CostReported: a.CostReported || b.CostReported}
}

func parse(r io.Reader, provider protocol.Provider, path string) []entry {
	var out []entry
	br := bufio.NewReaderSize(r, 1<<16)
	model, session := "", path
	var previous protocol.Usage
	for {
		line, err := br.ReadBytes('\n')
		if err != nil {
			break
		}
		var rec struct {
			Type      string    `json:"type"`
			Timestamp time.Time `json:"timestamp"`
			Message   struct {
				ID    string `json:"id"`
				Model string `json:"model"`
				Usage *struct {
					Input  int64 `json:"input_tokens"`
					Output int64 `json:"output_tokens"`
					Read   int64 `json:"cache_read_input_tokens"`
					Write  int64 `json:"cache_creation_input_tokens"`
				} `json:"usage"`
			} `json:"message"`
			Payload struct {
				Type  string `json:"type"`
				ID    string `json:"id"`
				Model string `json:"model"`
				Info  *struct {
					Total *struct {
						Input  int64 `json:"input_tokens"`
						Output int64 `json:"output_tokens"`
						Cached int64 `json:"cached_input_tokens"`
					} `json:"total_token_usage"`
				} `json:"info"`
			} `json:"payload"`
		}
		if json.Unmarshal(line, &rec) != nil {
			continue
		}
		e := entry{Provider: provider, At: rec.Timestamp}
		switch provider {
		case protocol.Claude:
			u := rec.Message.Usage
			if rec.Type != "assistant" || u == nil || rec.Message.ID == "" {
				continue
			}
			e.ID, e.Model = "claude/"+rec.Message.ID, rec.Message.Model
			e.Usage = protocol.Usage{InputTokens: max(0, u.Input), OutputTokens: max(0, u.Output), CacheReadTokens: max(0, u.Read), CacheWriteTokens: max(0, u.Write)}
		case protocol.Codex:
			if rec.Type == "session_meta" && rec.Payload.ID != "" {
				session = rec.Payload.ID
			}
			if rec.Type == "turn_context" {
				model = rec.Payload.Model
			}
			info := rec.Payload.Info
			if rec.Type != "event_msg" || rec.Payload.Type != "token_count" || info == nil || info.Total == nil {
				continue
			}
			u := info.Total
			cur := protocol.Usage{InputTokens: max(0, u.Input-u.Cached), OutputTokens: max(0, u.Output), CacheReadTokens: max(0, u.Cached)}
			e.ID, e.Model = fmt.Sprintf("codex/%s/%d/%d/%d", session, u.Input, u.Cached, u.Output), model
			e.Usage = protocol.Usage{InputTokens: max(0, cur.InputTokens-previous.InputTokens), OutputTokens: max(0, cur.OutputTokens-previous.OutputTokens), CacheReadTokens: max(0, cur.CacheReadTokens-previous.CacheReadTokens)}
			previous = maximum(previous, cur)
		}
		if !e.At.IsZero() {
			out = append(out, e)
		}
	}
	return out
}

package usage

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

func TestHistoricalUsage(t *testing.T) {
	paths.Home = t.TempDir()
	write := func(rel, body string) {
		t.Helper()
		p := filepath.Join(paths.Home, rel)
		os.MkdirAll(filepath.Dir(p), 0o700)
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write(".claude/projects/p/s.jsonl", `{"type":"assistant","timestamp":"2026-11-05T12:00:00Z","message":{"id":"m1","model":"sonnet","usage":{"input_tokens":10,"output_tokens":1,"cache_read_input_tokens":20,"cache_creation_input_tokens":5}}}
{"type":"assistant","timestamp":"2026-11-05T12:00:00Z","message":{"id":"m1","model":"sonnet","usage":{"input_tokens":10,"output_tokens":8,"cache_read_input_tokens":20,"cache_creation_input_tokens":5}}}
{"type":"assistant","timestamp":"2026-11-05T12:00:00Z","message":{"id":"m1","model":"sonnet","usage":{"input_tokens":10,"output_tokens":3,"cache_read_input_tokens":20,"cache_creation_input_tokens":5}}}
{"type":"user","timestamp":"2026-11-05T12:00:00Z","message":{"usage":{"input_tokens":999}}}
{"type":"assistant","timestamp":"2026-11-05T12:00:00Z","message":`)
	write(".claude/projects/p/s/subagents/agent-a.jsonl", `{"type":"assistant","timestamp":"2026-11-05T12:00:00Z","message":{"id":"sub1","model":"haiku","usage":{"input_tokens":2,"output_tokens":3}}}
`)
	write(".codex/sessions/2026/11/05/rollout.jsonl", `{"type":"session_meta","payload":{"id":"cx"}}
{"type":"turn_context","payload":{"model":"gpt"}}
{"timestamp":"2026-11-05T13:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":10}}}}
{"timestamp":"2026-11-05T13:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":10}}}}
{"timestamp":"2026-11-06T13:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":150,"cached_input_tokens":60,"output_tokens":20}}}}
`)
	now := time.Date(2026, 11, 6, 18, 0, 0, 0, time.UTC)
	report := History(7, now)
	if len(report.Days) != 7 {
		t.Fatalf("days: %+v", report.Days)
	}
	u := report.Total
	if u.InputTokens != 102 || u.OutputTokens != 31 || u.CacheReadTokens != 80 || u.CacheWriteTokens != 5 {
		t.Fatalf("double counted or lost tokens: %+v", u)
	}
	if report.Days[6].InputTokens != 30 || report.Days[6].OutputTokens != 10 {
		t.Fatalf("cumulative usage assigned to wrong day: %+v", report.Days[6])
	}
	if again := History(7, now); again.Total != report.Total {
		t.Fatalf("rescan double counted: %+v", again.Total)
	}
}

func TestHistoryLocalDaysAndCacheInvalidation(t *testing.T) {
	paths.Home = t.TempDir()
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(paths.Home, ".claude", "projects", "p")
	os.MkdirAll(dir, 0o700)
	p := filepath.Join(dir, "s.jsonl")
	line := `{"type":"assistant","timestamp":"2026-11-06T01:00:00Z","message":{"id":"message","model":"sonnet","usage":{"input_tokens":3,"output_tokens":2}}}` + "\n"
	os.WriteFile(p, []byte(line), 0o600)
	now := time.Date(2026, 11, 6, 12, 0, 0, 0, loc)
	report := History(7, now)
	if report.Days[5].InputTokens != 3 || report.Days[6].InputTokens != 0 {
		t.Fatalf("not assigned to Mac local day: %+v", report.Days)
	}
	os.WriteFile(p, []byte(line+strings.ReplaceAll(line, `"id":"message"`, `"id":"second"`)), 0o600)
	if got := History(7, now).Total.InputTokens; got != 6 {
		t.Fatalf("append wasn't rescanned: %d", got)
	}
	copyPath := filepath.Join(dir, "copy.jsonl")
	os.WriteFile(copyPath, []byte(line), 0o600)
	if got := History(7, now).Total.InputTokens; got != 6 {
		t.Fatalf("copy counted the same message twice: %d", got)
	}
}

func TestHistoryRouteAndCorruptLedger(t *testing.T) {
	paths.Home = t.TempDir()
	mux := http.NewServeMux()
	Routes(mux, func(fn http.HandlerFunc) http.HandlerFunc { return fn })
	for _, tc := range []struct {
		Query string
		Code  int
	}{{"", 200}, {"?days=7", 200}, {"?days=90", 200}, {"?days=-1", 400}, {"?days=100000", 400}} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("GET", "/usage/history"+tc.Query, nil))
		if rec.Code != tc.Code {
			t.Fatalf("%s: %d", tc.Query, rec.Code)
		}
	}
	os.MkdirAll(filepath.Dir(ledgerFile()), 0o700)
	os.WriteFile(ledgerFile(), []byte("{broken"), 0o600)
	if err := Record("id", protocol.Provider("devin"), "", time.Now(), protocol.Usage{}); err == nil {
		t.Fatal("must not overwrite a corrupt store")
	}
	if report := History(7, time.Now()); !strings.Contains(strings.Join(report.Notes, " "), "could not be read") {
		t.Fatal("missing store warning")
	}
}

func TestReportedUsagePersistsWithoutDuplicates(t *testing.T) {
	paths.Home = t.TempDir()
	now := time.Now()
	u := protocol.Usage{InputTokens: 12, OutputTokens: 7, CostUSD: 0.02}
	if err := Record("devin/session/turn", protocol.Provider("devin"), "model", now, u); err != nil {
		t.Fatal(err)
	}
	if err := Record("devin/session/turn", protocol.Provider("devin"), "model", now, u); err != nil {
		t.Fatal(err)
	}
	report := History(7, now)
	if report.Total.InputTokens != 12 || report.Total.CostUSD != 0.02 {
		t.Fatalf("record duplicated: %+v", report.Total)
	}
	if _, err := os.Stat(filepath.Join(paths.Home, ".luther", "tokens.json")); err != nil {
		t.Fatal(err)
	}
}

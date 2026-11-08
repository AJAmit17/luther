package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/tools"
)

type fakeRT struct{ sent []string }

func (f *fakeRT) Send(m string, _ []string) error                { f.sent = append(f.sent, m); return nil }
func (f *fakeRT) Interrupt() error                               { return nil }
func (f *fakeRT) Answer(*protocol.Prompt, protocol.Answer) error { return nil }
func (f *fakeRT) SetMode(string) error                           { return nil }
func (f *fakeRT) SetModel(string) error                          { return nil }
func (f *fakeRT) SetEffort(string) error                         { return nil }
func (f *fakeRT) SetFast(bool) error                             { return nil }
func (f *fakeRT) Stop()                                          {}

func openFake(t *testing.T, id, cwd, mode string) (*hub.Thread, *fakeRT, string) {
	t.Helper()
	th := hub.New(id, protocol.State{Provider: protocol.Claude, Session: id, Cwd: cwd, Mode: mode})
	rt := &fakeRT{}
	th.SetRuntime(rt)
	hub.Register(th)
	t.Cleanup(th.End)
	tok, _ := tools.ForThread(1)
	tools.Bind(tok, id)
	return th, rt, tok
}

func TestAgentTools(t *testing.T) {
	paths.Home = t.TempDir()
	proj := filepath.Join(paths.Home, "proj")
	os.MkdirAll(proj, 0o755)
	os.WriteFile(filepath.Join(proj, "report.html"), []byte("<h1>hi</h1>"), 0o644)
	os.WriteFile(filepath.Join(proj, "notes.txt"), []byte("no"), 0o644)

	mux := http.NewServeMux()
	toolRoutes(mux)
	th, _, tok := openFake(t, "parent-1", proj, protocol.ModeAsk)

	call := func(tok, name string, args any) (int, map[string]any) {
		b, _ := json.Marshal(args)
		req := httptest.NewRequest("POST", "/agent-tools/"+name, bytes.NewReader(b))
		req.RemoteAddr = "127.0.0.1:5555"
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		var out map[string]any
		json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}

	if code, _ := call("wrong", "show_artifact", map[string]any{}); code != http.StatusUnauthorized {
		t.Fatalf("bad token: %d", code)
	}
	// Through a tunnel the token is refused even when right.
	b, _ := json.Marshal(map[string]any{"title": "x", "html": "<p>"})
	req := httptest.NewRequest("POST", "/agent-tools/show_artifact", bytes.NewReader(b))
	req.RemoteAddr = "127.0.0.1:5555"
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Cf-Ray", "abc")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("tunnel: %d", rec.Code)
	}

	for _, bad := range []map[string]any{
		{"title": "x", "path": "notes.txt"},
		{"title": "x", "path": "../outside.html"},
		{"title": "x", "path": "missing.html"},
		{"title": "", "path": "report.html"},
		{"title": "x"},
		{"title": "x", "path": "report.html", "html": "<p>"},
	} {
		if _, out := call(tok, "show_artifact", bad); out["isError"] != true {
			t.Fatalf("accepted %v: %v", bad, out)
		}
	}
	for _, good := range []map[string]any{{"title": "Report", "path": "report.html"}, {"title": "Inline", "html": "<p>made</p>"}} {
		if _, out := call(tok, "show_artifact", good); out["isError"] == true {
			t.Fatalf("refused %v: %v", good, out)
		}
	}
	// Both cards are in the thread; showing one again adds nothing.
	call(tok, "show_artifact", map[string]any{"title": "Report", "path": "report.html"})
	cards := 0
	snap := snapshotMsgs(t, th)
	for _, m := range snap {
		if m.Role == "artifact" {
			cards++
		}
	}
	if cards != 2 {
		t.Fatalf("cards: %d in %+v", cards, snap)
	}

	// Another open thread is out of reach unless this one started it.
	other, _, _ := openFake(t, "other-1", proj, protocol.ModeAsk)
	if _, out := call(tok, "send_message", map[string]any{"thread": other.ID, "text": "hi"}); out["isError"] != true {
		t.Fatalf("reached a thread it didn't start: %v", out)
	}
	tools.AddChild(th.ID, other.ID)
	if _, out := call(tok, "send_message", map[string]any{"thread": other.ID, "text": "hi"}); out["isError"] == true {
		t.Fatalf("child send: %v", out)
	}
	_, out := call(tok, "wait_for_thread", map[string]any{"thread": other.ID, "timeout_seconds": 0})
	if text, _ := out["text"].(string); !strings.Contains(text, "working") && !strings.Contains(text, "Still") {
		t.Fatalf("a just-sent child should count as working: %v", out)
	}

	// More access than the caller's is refused before anything starts.
	if _, out := call(tok, "start_thread", map[string]any{"agent": "claude", "prompt": "go", "mode": "full"}); out["isError"] != true {
		t.Fatalf("escalated: %v", out)
	}
}

// snapshotMsgs: the messages a client would get.
func snapshotMsgs(t *testing.T, th *hub.Thread) []protocol.Msg {
	t.Helper()
	return th.Messages()
}

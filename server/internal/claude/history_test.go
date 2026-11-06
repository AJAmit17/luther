package claude

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

func rec(t *testing.T, s string) chatRec {
	t.Helper()
	var r chatRec
	if err := json.Unmarshal([]byte(s), &r); err != nil {
		t.Fatal(err)
	}
	return r
}

// A picture sent with a message shows on that message, kept where GET /uploads/{name} finds it.
func TestUserImagesKept(t *testing.T) {
	paths.Home = t.TempDir()
	png := "iVBORw0KGgo=" // any base64
	msgs := recMsgs(rec(t, `{"type":"user","uuid":"u1","message":{"role":"user","content":[
		{"type":"image","source":{"type":"base64","media_type":"image/png","data":"`+png+`"}},
		{"type":"text","text":"what's this"}]}}`))
	if len(msgs) != 1 || msgs[0].Text != "what's this" || len(msgs[0].Images) != 1 {
		t.Fatalf("got %+v", msgs)
	}
	if _, err := os.Stat(filepath.Join(paths.Home, ".luther", "uploads", msgs[0].Images[0])); err != nil {
		t.Fatal(err)
	}
	// An image alone still makes a message.
	msgs = recMsgs(rec(t, `{"type":"user","uuid":"u2","message":{"role":"user","content":[
		{"type":"image","source":{"type":"base64","media_type":"image/png","data":"`+png+`"}}]}}`))
	if len(msgs) != 1 || msgs[0].Role != "user" || len(msgs[0].Images) != 1 {
		t.Fatalf("got %+v", msgs)
	}
}

// Command output loses the CLI's colour codes and backticks.
func TestCommandOutputClean(t *testing.T) {
	msgs := recMsgs(rec(t, `{"type":"user","uuid":"u3","message":{"role":"user","content":"<local-command-stdout>Set model to \u001b[1msonnet\u001b[22m (`+"`claude-sonnet`"+`)</local-command-stdout>"}}`))
	if len(msgs) != 1 || msgs[0].Text != "Set model to sonnet (claude-sonnet)" {
		t.Fatalf("got %+v", msgs)
	}
}

func TestModelSet(t *testing.T) {
	sys := func(s string) protocol.Msg { return protocol.Msg{Role: "system", Text: s} }
	for in, want := range map[string]string{"Set model to haiku (claude-haiku-5-5)": "claude-haiku-5-5", "Set model to opus": "opus", "Context compacted": ""} {
		if got := modelSet(sys(in)); got != want {
			t.Errorf("%q: got %q want %q", in, got, want)
		}
	}
	if modelSet(protocol.Msg{Role: "user", Text: "Set model to x"}) != "" {
		t.Error("user text taken")
	}
}

// Claude Code's answer to initialize gives the /model menu, versions included.
func TestParseInitModels(t *testing.T) {
	line := `{"type":"control_response","response":{"request_id":"luther-models","response":{"models":[
		{"value":"default","resolvedModel":"claude-opus-5-5","displayName":"Default (recommended)"},
		{"value":"opus","resolvedModel":"claude-opus-5-5","displayName":"Opus 5.5","description":"For complex work"},
		{"value":"haiku","resolvedModel":"claude-haiku-5-5","displayName":"Haiku 5.5"}]}}}`
	ms, ok := parseInitModels([]byte(line))
	if !ok || len(ms) != 2 || ms[0] != (protocol.Model{ID: "opus", Name: "Opus 5.5", Desc: "For complex work", Resolved: "claude-opus-5-5"}) {
		t.Fatalf("got %+v %v", ms, ok)
	}
	if _, ok := parseInitModels([]byte(`{"type":"system"}`)); ok {
		t.Fatal("other line taken")
	}
}

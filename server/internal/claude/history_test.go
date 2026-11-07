package claude

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
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
		{"value":"opus","resolvedModel":"claude-opus-5-5","displayName":"Opus 5.5","description":"For complex work","supportedEffortLevels":["low","max"],"supportsFastMode":true},
		{"value":"haiku","resolvedModel":"claude-haiku-5-5","displayName":"Haiku 5.5"}]}}}`
	ms, ok := parseInitModels([]byte(line))
	if !ok || len(ms) != 2 || !reflect.DeepEqual(ms[0], protocol.Model{ID: "opus", Name: "Opus 5.5", Desc: "For complex work", Resolved: "claude-opus-5-5", Efforts: []string{"low", "max"}, Fast: true}) {
		t.Fatalf("got %+v %v", ms, ok)
	}
	if _, ok := parseInitModels([]byte(`{"type":"system"}`)); ok {
		t.Fatal("other line taken")
	}
}

// A typed /effort shows only in Claude's output; fast mode reads n/a when the
// account can't have it.
func TestEffortAndFast(t *testing.T) {
	if e := effortSet(protocol.Msg{Role: "system", Text: "Set effort level to xhigh (this session only): Deeper"}); e != "xhigh" {
		t.Errorf("got %q", e)
	}
	if effortSet(protocol.Msg{Role: "user", Text: "Set effort level to low"}) != "" {
		t.Error("user text taken")
	}
	var st protocol.State
	fastState(&st, "off", "sdk_opt_in_required")
	if st.Fast != "" || st.FastNote != "" {
		t.Errorf("not asked yet tells nothing: %+v", st)
	}
	if why, ok := parseInitFast([]byte(`{"type":"control_response","response":{"request_id":"luther-fast","response":{"fast_mode_state":"off","fast_mode_disabled_reason":"preference"}}}`)); !ok || why != "preference" {
		t.Errorf("fast answer: %q %v", why, ok)
	}
	fastState(&st, "off", "preference")
	if st.Fast != "" || st.FastNote == "" {
		t.Errorf("org off: %+v", st)
	}
	fastState(&st, "on", "")
	if st.Fast != "on" || st.FastNote != "" {
		t.Errorf("on: %+v", st)
	}
}

// A resumed session shows the effort its last reply used.
func TestLastEffort(t *testing.T) {
	paths.Home = t.TempDir() // never Claude's real store
	dir := filepath.Join(root(), "-proj")
	os.MkdirAll(dir, 0o700)
	sid := "11111111-2222-3333-4444-555555555555"
	os.WriteFile(filepath.Join(dir, sid+".jsonl"), []byte(`{"type":"assistant","effort":"medium","message":{}}
{"type":"user","message":{"content":[{"type":"tool_result","content":"{\"effort\":\"max\"}"}]}}
{"type":"assistant","effort":"xhigh","perTurnEffort":"xhigh","message":{}}
{"type":"user","effort":"low"}
`), 0o600)
	if e := lastEffort(sid); e != "xhigh" {
		t.Fatalf("got %q", e)
	}
	if lastEffort("00000000-0000-0000-0000-000000000000") != "" {
		t.Fatal("missing session")
	}
}

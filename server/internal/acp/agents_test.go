package acp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/rpc"
)

// With LUTHER_FAKE_ACP set, the test binary is a minimal ACP agent: it answers
// initialize, and only when its env came through.
func TestMain(m *testing.M) {
	if os.Getenv("LUTHER_FAKE_ACP") == "1" {
		sc := bufio.NewScanner(os.Stdin)
		for sc.Scan() {
			var msg rpc.Msg
			json.Unmarshal(sc.Bytes(), &msg)
			if msg.Method == "initialize" && os.Getenv("FAKE_TOKEN") == "from-agents-json" {
				fmt.Printf(`{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true}}}`+"\n", msg.ID)
			}
		}
		return
	}
	os.Exit(m.Run())
}

func writeAgents(t *testing.T, list string) {
	t.Helper()
	os.MkdirAll(filepath.Dir(File()), 0o700)
	if err := os.WriteFile(File(), []byte(list), 0o600); err != nil {
		t.Fatal(err)
	}
}

// Your agents file adds agents, replaces a built-in by id, names them, and a
// bad file leaves the built-ins working.
func TestAgentsFile(t *testing.T) {
	paths.Home = t.TempDir()
	writeAgents(t, `[{"id":"goose","name":"goose","command":["goose"],"args":["acp"]},
		{"id":"gemini","name":"My Gemini","command":["gemini-nightly"],"args":["--acp"]}]`)
	g, ok := Find("goose")
	if !ok || g.Bins[0] != "goose" || g.Args[0] != "acp" {
		t.Fatalf("goose: %+v", g)
	}
	if gm, _ := Find("gemini"); gm.Bins[0] != "gemini-nightly" || protocol.Provider("gemini").Name() != "My Gemini" {
		t.Fatalf("gemini not replaced: %+v", gm)
	}
	if _, ok := Find("copilot"); !ok {
		t.Fatal("built-ins must stay")
	}
	writeAgents(t, `[{"id":"Claude!","command":["x"]}]`)
	os.Chtimes(File(), timeNow(), timeNow())
	if LoadError() == nil {
		t.Fatal("a bad id must be reported")
	}
	if _, ok := Find("devin"); !ok {
		t.Fatal("built-ins must survive a bad file")
	}
}

// An agent that exists only in agents.json starts through the one ACP client,
// with its env.
func TestUserAgentStarts(t *testing.T) {
	paths.Home = t.TempDir()
	self, _ := os.Executable()
	b, _ := json.Marshal([]map[string]any{{"id": "fake", "name": "Fake", "command": []string{self},
		"env": map[string]string{"LUTHER_FAKE_ACP": "1", "FAKE_TOKEN": "from-agents-json"}}})
	writeAgents(t, string(b))
	a, ok := Find("fake")
	if !ok {
		t.Fatal("not listed")
	}
	if v, installed := a.Version(); !installed {
		t.Fatalf("installed: %v %q", installed, v)
	}
	s, err := srv(a)
	if err != nil {
		t.Fatal(err)
	}
	defer s.cmd.Process.Kill()
	if !s.caps.LoadSession {
		t.Fatal("initialize result not read")
	}
}

func timeNow() (t time.Time) { return time.Now().Add(time.Second) }

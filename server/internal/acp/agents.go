package acp

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sync"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
)

// Agent: how to start one ACP agent. An agent is only this: no code of its own.
type Agent struct {
	ID   protocol.Provider `json:"id"`
	Name string            `json:"name"`
	Bins []string          `json:"command"` // tried in order; the first on PATH runs
	Args []string          `json:"args"`
	Env  map[string]string `json:"env,omitempty"`
	// Modes: the agent's own mode for a Luther mode (ask, edits, plan, full),
	// where its default isn't right. Unnamed: its default (plan: a mode named *plan*).
	Modes map[string]string `json:"modes,omitempty"`
}

// builtIn: the ACP agents Luther knows; commands from the ACP registry
// (github.com/agentclientprotocol/registry).
var builtIn = []Agent{
	{ID: "opencode", Name: "OpenCode", Bins: []string{"opencode"}, Args: []string{"acp"}},
	{ID: "gemini", Name: "Gemini CLI", Bins: []string{"gemini"}, Args: []string{"--acp"}},
	{ID: "cursor", Name: "Cursor", Bins: []string{"cursor-agent", "agent"}, Args: []string{"acp"}},
	{ID: "devin", Name: "Devin", Bins: []string{"devin"}, Args: []string{"acp"},
		Modes: map[string]string{protocol.ModeAsk: "ask", protocol.ModeEdits: "accept-edits", protocol.ModePlan: "plan", protocol.ModeFull: "bypass"}},
	{ID: "omp", Name: "Oh My Pi", Bins: []string{"omp"}, Args: []string{"acp"}},
	{ID: "copilot", Name: "GitHub Copilot", Bins: []string{"copilot"}, Args: []string{"--acp", "--stdio"}},
	{ID: "kimi", Name: "Kimi", Bins: []string{"kimi"}, Args: []string{"acp"}},
	{ID: "qwen", Name: "Qwen Code", Bins: []string{"qwen"}, Args: []string{"--acp"}},
	{ID: "droid", Name: "Droid", Bins: []string{"droid"}, Args: []string{"exec", "--output-format", "acp-daemon"},
		Env: map[string]string{"DROID_DISABLE_AUTO_UPDATE": "true"}},
	{ID: "grok", Name: "Grok", Bins: []string{"grok"}, Args: []string{"agent", "stdio"}},
	{ID: "amp", Name: "Amp", Bins: []string{"amp-acp"}},
}

// File: your own ACP agents, a JSON list of Agent; one with a built-in's id replaces it.
//
//	[{"id": "goose", "name": "goose", "command": ["goose"], "args": ["acp"]}]
func File() string { return filepath.Join(paths.Home, ".luther", "agents.json") }

var idRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`)

var loaded = struct {
	sync.Mutex
	mod  int64
	list []Agent
	err  error
}{mod: -1}

// Agents: the built-ins, then yours (re-read when the file changes).
func Agents() []Agent {
	var mod int64
	if fi, err := os.Stat(File()); err == nil {
		mod = fi.ModTime().UnixNano()
	}
	loaded.Lock()
	defer loaded.Unlock()
	if mod != loaded.mod {
		loaded.list, loaded.err = merge(builtIn, File())
		loaded.mod = mod
		if loaded.err != nil {
			fmt.Fprintln(os.Stderr, "luther:", loaded.err)
		}
		for _, a := range loaded.list {
			protocol.SetName(a.ID, a.Name)
		}
	}
	return loaded.list
}

// LoadError: why your agents file was skipped, if it was.
func LoadError() error {
	Agents()
	loaded.Lock()
	defer loaded.Unlock()
	return loaded.err
}

func merge(base []Agent, file string) ([]Agent, error) {
	out := append([]Agent(nil), base...)
	b, err := os.ReadFile(file)
	if err != nil {
		return out, nil // no file: built-ins only
	}
	var mine []Agent
	if err := json.Unmarshal(b, &mine); err != nil {
		return out, fmt.Errorf("%s: %v", file, err)
	}
	for _, a := range mine {
		if !idRe.MatchString(string(a.ID)) || a.ID == protocol.Claude || a.ID == protocol.Codex || len(a.Bins) == 0 {
			return out, fmt.Errorf("%s: agent %q needs an id (a-z, 0-9, - or _; not claude or codex) and a command", file, a.ID)
		}
		a.Name = text.OrDefault(a.Name, string(a.ID))
		replaced := false
		for i := range out {
			if out[i].ID == a.ID {
				out[i], replaced = a, true
			}
		}
		if !replaced {
			out = append(out, a)
		}
	}
	return out, nil
}

func Find(p protocol.Provider) (Agent, bool) {
	for _, a := range Agents() {
		if a.ID == p {
			return a, true
		}
	}
	return Agent{}, false
}

// Bin: the first of Bins on PATH, or "".
func (a Agent) Bin() string {
	for _, b := range a.Bins {
		if p, err := exec.LookPath(b); err == nil {
			return p
		}
	}
	return ""
}

// Version: `<bin> --version` when it answers (an adapter may not); installed = on PATH.
func (a Agent) Version() (string, bool) {
	b := a.Bin()
	if b == "" {
		return "", false
	}
	out, _ := exec.Command(b, "--version").Output()
	return text.OneLine(string(out)), true
}

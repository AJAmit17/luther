// Package oneshot: a single question to a model through an installed agent
// CLI, with an answer in a JSON shape, no tools, and nothing saved: Claude
// (`claude -p --no-session-persistence --tools ""`, Haiku), or Codex
// (`codex exec --ephemeral`, read-only) when asked for Codex or Claude isn't
// installed, or Claude refused. Goals' judge and commit messages use it.
package oneshot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/AJAmit17/luther/server/internal/claudeaccounts"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
)

var (
	ClaudeBin = "claude"
	CodexBin  = "codex"
)

const timeout = 3 * time.Minute

// Ask sends prompt and returns the JSON object the model answered, shaped by
// schema (a JSON Schema). prefer: Codex is used for Codex threads.
func Ask(prefer protocol.Provider, prompt, schema string) ([]byte, error) {
	_, claudeErr := exec.LookPath(ClaudeBin)
	_, codexErr := exec.LookPath(CodexBin)
	switch {
	case codexErr == nil && (prefer == protocol.Codex || claudeErr != nil):
		return byCodex(prompt, schema)
	case claudeErr == nil:
		out, err := byClaude(prompt, schema)
		if err != nil && codexErr == nil {
			// Claude refused (a usage limit, signed out): Codex answers instead.
			if out, cerr := byCodex(prompt, schema); cerr == nil {
				return out, nil
			}
		}
		return out, err
	}
	return nil, errors.New("this needs Claude Code or Codex installed on the Mac")
}

func byClaude(prompt, schema string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, ClaudeBin, "-p", "--no-session-persistence", "--tools", "", "--model", "haiku",
		"--output-format", "json", "--json-schema", schema)
	cmd.Dir = os.TempDir()
	_, accountEnv := claudeaccounts.Env() // the account Claude threads run under
	cmd.Env = append(os.Environ(), accountEnv...)
	cmd.Stdin = strings.NewReader(prompt)
	out, err := cmd.Output()
	var res struct {
		Result     string          `json:"result"`
		Structured json.RawMessage `json:"structured_output"`
		IsError    bool            `json:"is_error"`
	}
	if err != nil {
		// A refused call (a usage limit) still says why on stdout.
		if json.Unmarshal(out, &res) == nil && res.Result != "" {
			return nil, fmt.Errorf("Claude: %s", text.Clip(res.Result, 300))
		}
		return nil, fmt.Errorf("Claude failed: %w", err)
	}
	if json.Unmarshal(out, &res) != nil || res.IsError {
		return nil, fmt.Errorf("Claude answered: %s", text.Clip(strings.TrimSpace(string(out)), 300))
	}
	if len(res.Structured) > 0 {
		return Object([]byte(res.Structured))
	}
	return Object([]byte(res.Result))
}

func byCodex(prompt, schema string) ([]byte, error) {
	dir, err := os.MkdirTemp("", "luther-ask-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	sch, last := filepath.Join(dir, "schema.json"), filepath.Join(dir, "last.json")
	if err := os.WriteFile(sch, []byte(schema), 0o600); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, CodexBin, "exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only",
		"--output-schema", sch, "-o", last, "-")
	cmd.Dir = dir
	cmd.Stdin = strings.NewReader(prompt)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("Codex failed: %v %s", err, text.Clip(strings.TrimSpace(stderr.String()), 300))
	}
	b, err := os.ReadFile(last)
	if err != nil {
		return nil, errors.New("Codex gave no answer")
	}
	return Object(b)
}

// Object: the JSON object in an answer (bare, or inside a fenced block or prose).
func Object(raw []byte) ([]byte, error) {
	s := strings.TrimSpace(string(raw))
	if i, j := strings.Index(s, "{"), strings.LastIndex(s, "}"); i >= 0 && j > i {
		s = s[i : j+1]
	}
	if !json.Valid([]byte(s)) {
		return nil, fmt.Errorf("the answer wasn't readable: %s", text.Clip(s, 200))
	}
	return []byte(s), nil
}

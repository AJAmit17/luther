// Package goal: the judge behind a thread's goal. After each turn it gets the
// objective and the agent's latest reply, nothing else, and says done, blocked
// or continue with one sentence why. It's a one-off call to an agent CLI that
// saves no conversation and has no tools: Claude Haiku (`claude -p
// --no-session-persistence --tools ""`), or Codex (`codex exec --ephemeral`,
// read-only) when the thread is a Codex one or Claude isn't installed.
package goal

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

const schema = `{"type":"object","properties":{"verdict":{"type":"string","enum":["done","blocked","continue"]},"reason":{"type":"string"}},"required":["verdict","reason"],"additionalProperties":false}`

const ask = `You check whether a coding agent has reached a goal. You see only the goal and the agent's latest reply; you can't look at files or run anything, so judge from what the reply says.

Answer with a verdict and a one-sentence reason:
- done: the reply shows the goal is met (claims without evidence such as passing tests or a finished change don't count);
- blocked: the agent can't go on without the user (it needs access, a decision, or hit an error it says it can't fix);
- continue: more work is needed. The reason then says what is still missing, as an instruction to the agent.

Goal:
%s

The agent's latest reply:
%s`

// Verdict of one check.
type Verdict struct {
	Verdict string `json:"verdict"`
	Reason  string `json:"reason"`
}

// Judge asks the judge about one turn. prefer: the thread's agent (a Codex
// thread is judged by Codex).
func Judge(prefer protocol.Provider, objective, reply string) (Verdict, error) {
	prompt := fmt.Sprintf(ask, objective, text.OrDefault(strings.TrimSpace(text.Clip(reply, 20000)), "(no reply)"))
	_, claudeErr := exec.LookPath(ClaudeBin)
	_, codexErr := exec.LookPath(CodexBin)
	switch {
	case codexErr == nil && (prefer == protocol.Codex || claudeErr != nil):
		return byCodex(prompt)
	case claudeErr == nil:
		return byClaude(prompt)
	}
	return Verdict{}, errors.New("a goal needs Claude Code or Codex installed to check the turns")
}

func byClaude(prompt string) (Verdict, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, ClaudeBin, "-p", "--no-session-persistence", "--tools", "", "--model", "haiku",
		"--output-format", "json", "--json-schema", schema)
	cmd.Dir = os.TempDir()
	cmd.Stdin = strings.NewReader(prompt)
	out, err := cmd.Output()
	if err != nil {
		return Verdict{}, fmt.Errorf("the judge (Claude) failed: %w", err)
	}
	var res struct {
		Result     string          `json:"result"`
		Structured json.RawMessage `json:"structured_output"`
		IsError    bool            `json:"is_error"`
	}
	if json.Unmarshal(out, &res) != nil || res.IsError {
		return Verdict{}, fmt.Errorf("the judge (Claude) answered: %s", text.Clip(strings.TrimSpace(string(out)), 300))
	}
	raw := res.Structured
	if len(raw) == 0 {
		raw = json.RawMessage(res.Result)
	}
	return parse(raw)
}

func byCodex(prompt string) (Verdict, error) {
	dir, err := os.MkdirTemp("", "luther-judge-")
	if err != nil {
		return Verdict{}, err
	}
	defer os.RemoveAll(dir)
	sch, last := filepath.Join(dir, "schema.json"), filepath.Join(dir, "last.json")
	if err := os.WriteFile(sch, []byte(schema), 0o600); err != nil {
		return Verdict{}, err
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
		return Verdict{}, fmt.Errorf("the judge (Codex) failed: %v %s", err, text.Clip(strings.TrimSpace(stderr.String()), 300))
	}
	b, err := os.ReadFile(last)
	if err != nil {
		return Verdict{}, errors.New("the judge (Codex) gave no answer")
	}
	return parse(b)
}

// parse: the verdict, from JSON or JSON inside a fenced block.
func parse(raw []byte) (Verdict, error) {
	s := strings.TrimSpace(string(raw))
	if i, j := strings.Index(s, "{"), strings.LastIndex(s, "}"); i >= 0 && j > i {
		s = s[i : j+1]
	}
	var v Verdict
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		return Verdict{}, fmt.Errorf("the judge's answer wasn't readable: %s", text.Clip(s, 200))
	}
	switch v.Verdict {
	case "done", "blocked", "continue":
	default:
		return Verdict{}, fmt.Errorf("the judge said %q", v.Verdict)
	}
	v.Reason = strings.TrimSpace(v.Reason)
	return v, nil
}

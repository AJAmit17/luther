// Package goal: the judge behind a thread's goal. After each turn it gets the
// objective and the agent's latest reply, nothing else, and says done, blocked
// or continue with one sentence why (a oneshot call: no tools, nothing saved).
package goal

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/AJAmit17/luther/server/internal/oneshot"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
)

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
	raw, err := oneshot.Ask(prefer, prompt, schema)
	if err != nil {
		return Verdict{}, fmt.Errorf("the judge: %w", err)
	}
	return parse(raw)
}

// parse: the verdict, from JSON or JSON inside a fenced block.
func parse(raw []byte) (Verdict, error) {
	obj, err := oneshot.Object(raw)
	if err != nil {
		return Verdict{}, fmt.Errorf("the judge: %w", err)
	}
	var v Verdict
	if err := json.Unmarshal(obj, &v); err != nil {
		return Verdict{}, fmt.Errorf("the judge's answer wasn't readable: %s", text.Clip(string(obj), 200))
	}
	switch v.Verdict {
	case "done", "blocked", "continue":
	default:
		return Verdict{}, fmt.Errorf("the judge said %q", v.Verdict)
	}
	v.Reason = strings.TrimSpace(v.Reason)
	return v, nil
}

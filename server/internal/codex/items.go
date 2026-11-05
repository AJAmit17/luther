package codex

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
)

// ---- items → messages ----

func str(m map[string]any, k string) string { s, _ := m[k].(string); return s }

func toMsg(it map[string]any) (protocol.Msg, bool) {
	id := str(it, "id")
	switch it["type"] {
	case "userMessage":
		var parts []string
		if cs, ok := it["content"].([]any); ok {
			for _, c := range cs {
				if cm, ok := c.(map[string]any); ok && cm["type"] == "text" {
					parts = append(parts, str(cm, "text"))
				}
			}
		}
		if len(parts) == 0 {
			return protocol.Msg{}, false
		}
		return protocol.Msg{ID: id, Role: "user", Text: strings.Join(parts, "\n")}, true
	case "agentMessage":
		if strings.TrimSpace(str(it, "text")) == "" {
			return protocol.Msg{}, false
		}
		return protocol.Msg{ID: id, Role: "assistant", Text: str(it, "text")}, true
	case "plan":
		return protocol.Msg{ID: id, Role: "assistant", Text: "**Plan**\n" + str(it, "text")}, true
	case "commandExecution":
		text := text.Clip(str(it, "command"), 300)
		if code, ok := it["exitCode"].(float64); ok && code != 0 {
			text += fmt.Sprintf("  (exit %d)", int(code))
		}
		if it["status"] == "declined" {
			text += "  (declined)"
		}
		return protocol.Msg{ID: id, Role: "tool", Tool: "Shell", Text: text}, true
	case "fileChange":
		return protocol.Msg{ID: id, Role: "tool", Tool: "Edit", Text: fileChangeText(it, false)}, true
	case "mcpToolCall", "dynamicToolCall":
		name := str(it, "tool")
		if srv := str(it, "server"); srv != "" {
			name = srv + "." + name
		}
		return protocol.Msg{ID: id, Role: "tool", Tool: name}, true
	case "webSearch":
		return protocol.Msg{ID: id, Role: "tool", Tool: "WebSearch", Text: str(it, "query")}, true
	case "collabAgentToolCall": // Codex's subagents: spawn, message, wait…
		t := str(it, "tool")
		if pr := str(it, "prompt"); pr != "" {
			t += ": " + text.Clip(text.OneLine(pr), 200)
		}
		if sts, ok := it["agentsStates"].(map[string]any); ok {
			for _, v := range sts {
				if st, ok := v.(map[string]any); ok {
					t += " · " + str(st, "status")
					if m := str(st, "message"); m != "" {
						t += " — " + text.Clip(text.OneLine(m), 120)
					}
				}
			}
		}
		return protocol.Msg{ID: id, Role: "tool", Tool: "Agent", Text: t}, true
	case "contextCompaction":
		return protocol.Msg{ID: id, Role: "system", Text: "Context compacted"}, true
	}
	return protocol.Msg{}, false
}

// fileChangeText: changed paths (relative), plus clipped diffs for approvals.
func fileChangeText(it map[string]any, diffs bool) string {
	var b strings.Builder
	cs, _ := it["changes"].([]any)
	for _, c := range cs {
		cm, _ := c.(map[string]any)
		path := str(cm, "path")
		kind := ""
		if k, ok := cm["kind"].(map[string]any); ok {
			kind = str(k, "type")
		}
		fmt.Fprintf(&b, "%s %s\n", kind, filepath.Base(path))
		if diffs {
			b.WriteString(text.Clip(str(cm, "diff"), 1500) + "\n")
		}
	}
	return strings.TrimSpace(b.String())
}

// ---- past threads (Codex's own store, via the app-server) ----

func Sessions(cwd string) []protocol.Session {
	s, err := srv()
	if err != nil {
		return nil
	}
	params := map[string]any{"limit": 200}
	if cwd != "" {
		params["cwd"] = cwd
	}
	raw, err := s.Call("thread/list", params) // ponytail: first page only (200 newest)
	if err != nil {
		return nil
	}
	var out struct {
		Data []threadRec `json:"data"`
	}
	json.Unmarshal(raw, &out)
	var ss []protocol.Session
	for _, th := range out.Data {
		if th.Cwd == "" && len(th.Envs) > 0 {
			th.Cwd = th.Envs[0].Cwd
		}
		ss = append(ss, protocol.Session{Provider: protocol.Codex, ID: th.ID, Cwd: th.Cwd, Title: text.OneLine(text.OrDefault(th.Name, th.Preview)),
			Preview: text.OneLine(th.Preview), LastActive: time.Unix(th.Updated, 0)})
	}
	return ss
}

func Models() []string {
	s, err := srv()
	if err != nil {
		return nil
	}
	raw, err := s.Call("model/list", map[string]any{})
	if err != nil {
		return nil
	}
	var out struct {
		Data []struct {
			ID    string `json:"id"`
			Model string `json:"model"`
		} `json:"data"`
	}
	json.Unmarshal(raw, &out)
	var ms []string
	for _, m := range out.Data {
		ms = append(ms, text.OrDefault(m.ID, m.Model))
	}
	return ms
}

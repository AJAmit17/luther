package claude

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/AJAmit17/luther/server/internal/uploads"
)

// ---- history: Claude Code transcripts (~/.claude/projects/*/<sid>.jsonl) → messages ----

func root() string { return filepath.Join(paths.Home, ".claude", "projects") }

func history(sid string) []protocol.Msg {
	paths, _ := filepath.Glob(filepath.Join(root(), "*", sid+".jsonl"))
	if len(paths) == 0 {
		return nil
	}
	return readChat(paths[0])
}

var (
	cmdNameRe = regexp.MustCompile(`<command-name>(.*?)</command-name>`)
	cmdArgsRe = regexp.MustCompile(`(?s)<command-args>(.*?)</command-args>`)
	stdoutRe  = regexp.MustCompile(`(?s)<local-command-stdout>(.*?)</local-command-stdout>`)
	ansiRe    = regexp.MustCompile(`\x1b\[[0-9;]*[A-Za-z]`) // the CLI's colours in command output
)

type chatRec struct {
	Type        string `json:"type"`
	Subtype     string `json:"subtype"`
	UUID        string `json:"uuid"`
	IsMeta      bool   `json:"isMeta"`
	IsCompact   bool   `json:"isCompactSummary"`
	TransOnly   bool   `json:"isVisibleInTranscriptOnly"`
	IsSidechain bool   `json:"isSidechain"`
	Message     struct {
		Content json.RawMessage `json:"content"`
	} `json:"message"`
}

type block struct {
	ID     string         `json:"id"`
	Type   string         `json:"type"`
	Text   string         `json:"text"`
	Name   string         `json:"name"`
	Input  map[string]any `json:"input"`
	Source struct {
		MediaType string `json:"media_type"`
		Data      string `json:"data"`
	} `json:"source"`
}

func (r chatRec) hidden() bool { return r.IsSidechain || r.IsMeta || r.IsCompact || r.TransOnly }

// readChat parses a transcript. System records are matched by parsed type and
// subtype, never by substring (tool output can quote them).
func readChat(path string) []protocol.Msg {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var msgs []protocol.Msg
	br := bufio.NewReaderSize(f, 1<<16)
	for n := 0; ; n++ {
		line, err := br.ReadBytes('\n')
		if err != nil {
			break // partial last line
		}
		if bytes.Contains(line, []byte(`"subtype":"compact_boundary"`)) {
			var r chatRec
			if json.Unmarshal(line, &r) == nil && r.Type == "system" && r.Subtype == "compact_boundary" {
				msgs = append(msgs, protocol.Msg{ID: fmt.Sprint("compact@", n), Role: "system", Text: "Context compacted"})
			}
			continue
		}
		if !bytes.Contains(line, []byte(`"type":"user"`)) && !bytes.Contains(line, []byte(`"type":"assistant"`)) {
			continue
		}
		var r chatRec
		if json.Unmarshal(line, &r) != nil || r.hidden() {
			continue
		}
		msgs = append(msgs, recMsgs(r)...)
	}
	return msgs
}

func recMsgs(r chatRec) []protocol.Msg {
	var text string
	if json.Unmarshal(r.Message.Content, &text) == nil {
		if r.Type != "user" {
			return nil
		}
		if m := cmdNameRe.FindStringSubmatch(text); m != nil {
			cmd := m[1]
			if a := cmdArgsRe.FindStringSubmatch(text); a != nil && strings.TrimSpace(a[1]) != "" {
				cmd += " " + strings.TrimSpace(a[1])
			}
			return []protocol.Msg{{ID: r.UUID, Role: "user", Text: cmd}}
		}
		if m := stdoutRe.FindStringSubmatch(text); m != nil {
			if s := strings.TrimSpace(strings.ReplaceAll(ansiRe.ReplaceAllString(m[1], ""), "`", "")); s != "" {
				return []protocol.Msg{{ID: r.UUID, Role: "system", Text: s}}
			}
			return nil
		}
		if strings.HasPrefix(strings.TrimSpace(text), "<") {
			return nil // caveats and other wrappers
		}
		m := protocol.Msg{ID: r.UUID, Role: "user"}
		m.Text, m.Images = uploads.SplitAttached(text)
		return []protocol.Msg{m}
	}
	var blocks []block
	json.Unmarshal(r.Message.Content, &blocks)
	var out []protocol.Msg
	var images []string // a user's pictures, shown on their message
	for i, b := range blocks {
		id := fmt.Sprintf("%s#%d", r.UUID, i)
		switch {
		case b.Type == "image" && r.Type == "user":
			if name := uploads.Keep(b.Source.MediaType, b.Source.Data); name != "" {
				images = append(images, name)
			}
		case b.Type == "text" && strings.HasPrefix(b.Text, "[Image: original "): // the CLI's note on a resized image
		case b.Type == "text" && strings.TrimSpace(b.Text) != "" && !strings.HasPrefix(b.Text, "<"):
			role := "assistant"
			if r.Type == "user" {
				role = "user"
			}
			m := protocol.Msg{ID: id, Role: role, Text: b.Text}
			if role == "user" {
				m.Text, m.Images = uploads.SplitAttached(b.Text)
			}
			out = append(out, m)
		case b.Type == "tool_use":
			if isAgentTool(b.Name) && b.ID != "" {
				id = b.ID // a subagent's steps name this call as their Parent
			}
			out = append(out, protocol.Msg{ID: id, Role: "tool", Tool: b.Name, Text: toolSummary(b.Name, b.Input)})
		}
	}
	if len(images) > 0 {
		if len(out) > 0 && out[0].Role == "user" {
			out[0].Images = append(images, out[0].Images...)
		} else {
			out = append([]protocol.Msg{{ID: r.UUID + "#img", Role: "user", Images: images}}, out...)
		}
	}
	return out
}

func toolSummary(name string, in map[string]any) string {
	if name == "AskUserQuestion" {
		if qs, ok := in["questions"].([]any); ok && len(qs) > 0 {
			if q, ok := qs[0].(map[string]any); ok {
				return fmt.Sprint(q["question"])
			}
		}
	}
	for _, k := range []string{"description", "command", "file_path", "pattern", "url", "query", "prompt", "skill"} {
		if v, ok := in[k].(string); ok && v != "" {
			return text.Clip(v, 300)
		}
	}
	return ""
}

// isAgentTool: the tool that starts a subagent ("Task", newer CLIs "Agent").
func isAgentTool(name string) bool { return name == "Task" || name == "Agent" }

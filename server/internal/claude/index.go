package claude

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/AJAmit17/luther/server/internal/uploads"
)

// Index: Claude Code's transcripts (~/.claude/projects/*/*.jsonl), read-only and
// stat-cached, as sessions.

var index = &indexer{cache: map[string]cachedSession{}}

// Sessions: every Claude conversation on this Mac (rescanned per call; cheap).
func Sessions() []protocol.Session { return index.sessions() }

type indexer struct {
	mu    sync.Mutex
	cache map[string]cachedSession
}

type cachedSession struct {
	mod  time.Time
	size int64
	s    protocol.Session
	ok   bool
}

// Sessions rescans the store; unchanged files (same mtime+size) come from cache.
// Top level only: <id>/subagents/ are sidechains.
func (ix *indexer) sessions() []protocol.Session {
	paths, _ := filepath.Glob(filepath.Join(root(), "*", "*.jsonl"))
	ix.mu.Lock()
	defer ix.mu.Unlock()
	seen := map[string]bool{}
	var out []protocol.Session
	for _, p := range paths {
		fi, err := os.Stat(p)
		if err != nil {
			continue
		}
		seen[p] = true
		c, hit := ix.cache[p]
		if !hit || !c.mod.Equal(fi.ModTime()) || c.size != fi.Size() {
			c = cachedSession{mod: fi.ModTime(), size: fi.Size()}
			if f, err := os.Open(p); err == nil {
				c.s, c.ok = parseSession(f)
				f.Close()
			}
			c.s.Provider = protocol.Claude
			c.s.ID = strings.TrimSuffix(filepath.Base(p), ".jsonl")
			c.s.LastActive = fi.ModTime()
			ix.cache[p] = c
		}
		if c.ok {
			out = append(out, c.s)
		}
	}
	for p := range ix.cache {
		if !seen[p] {
			delete(ix.cache, p)
		}
	}
	return out
}

type sessionRec struct {
	Type        string `json:"type"`
	Cwd         string `json:"cwd"`
	IsMeta      bool   `json:"isMeta"`
	CustomTitle string `json:"customTitle"`
	AITitle     string `json:"aiTitle"`
	LastPrompt  string `json:"lastPrompt"`
	Message     struct {
		Content json.RawMessage `json:"content"`
	} `json:"message"`
}

var (
	preCustom = []byte(`{"type":"custom-title"`)
	preAI     = []byte(`{"type":"ai-title"`)
	preLast   = []byte(`{"type":"last-prompt"`)
	hasCwd    = []byte(`"cwd":"`)
	hasUser   = []byte(`"type":"user"`)
)

// parseSession: cwd from the first record that has one (never the folder
// name: its encoding is lossy); title = custom > AI > first real prompt, last
// occurrence wins. Only lines that can matter are unmarshalled (files reach 60MB+).
func parseSession(r io.Reader) (protocol.Session, bool) {
	var s protocol.Session
	var custom, ai, first string
	br := bufio.NewReaderSize(r, 1<<16)
	for {
		line, err := br.ReadBytes('\n')
		if len(line) > 0 {
			wantCwd := s.Cwd == "" && bytes.Contains(line, hasCwd)
			wantFirst := first == "" && bytes.Contains(line, hasUser)
			isTitle := bytes.HasPrefix(line, preCustom) || bytes.HasPrefix(line, preAI) || bytes.HasPrefix(line, preLast)
			if wantCwd || wantFirst || isTitle {
				var rec sessionRec
				if json.Unmarshal(line, &rec) == nil {
					if wantCwd && rec.Cwd != "" {
						s.Cwd = rec.Cwd
					}
					switch rec.Type {
					case "custom-title":
						custom = rec.CustomTitle
					case "ai-title":
						ai = rec.AITitle
					case "last-prompt":
						s.Preview = text.OneLine(attachedOff(rec.LastPrompt))
					case "user":
						if wantFirst && !rec.IsMeta {
							first = promptText(rec.Message.Content)
						}
					}
				}
			}
		}
		if err != nil {
			break
		}
	}
	s.Title = text.OrDefault(custom, text.OrDefault(ai, attachedOff(first)))
	s.Preview = text.OrDefault(s.Preview, attachedOff(first))
	return s, s.Cwd != ""
}

// promptText: the typed prompt, or "" for tool results and <command-…> wrappers.
func promptText(raw json.RawMessage) string {
	var msg string
	if json.Unmarshal(raw, &msg) != nil {
		var blocks []struct{ Type, Text string }
		json.Unmarshal(raw, &blocks)
		for _, b := range blocks {
			if b.Type == "text" {
				msg = b.Text
				break
			}
		}
	}
	msg = text.OneLine(msg)
	if strings.HasPrefix(msg, "<") {
		return ""
	}
	return msg
}

// attachedOff: a prompt without its "Attached files: …" paths (photos are
// shown as pictures, not as their paths on the Mac).
func attachedOff(prompt string) string {
	t, images := uploads.SplitAttached(prompt)
	if t == "" && len(images) > 0 {
		return "Photo"
	}
	return t
}

package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Session index: past conversations come from each CLI's own store, read-only.
// Claude: ~/.claude/projects/*/*.jsonl, parsed here (stat-cached). Codex: its
// app-server's thread/list. Projects are the folders those sessions ran in.

var claudeIndex = &indexer{cache: map[string]cachedSession{}}

type indexer struct {
	mu    sync.Mutex
	cache map[string]cachedSession
}

type cachedSession struct {
	mod  time.Time
	size int64
	s    Session
	ok   bool
}

// Sessions rescans the store; unchanged files (same mtime+size) come from cache.
// Top level only: <id>/subagents/ are sidechains.
func (ix *indexer) Sessions() []Session {
	paths, _ := filepath.Glob(filepath.Join(claudeRoot(), "*", "*.jsonl"))
	ix.mu.Lock()
	defer ix.mu.Unlock()
	seen := map[string]bool{}
	var out []Session
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
				c.s, c.ok = parseClaudeSession(f)
				f.Close()
			}
			c.s.Provider = Claude
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

// parseClaudeSession: cwd from the first record that has one (never the folder
// name: its encoding is lossy); title = custom > AI > first real prompt, last
// occurrence wins. Only lines that can matter are unmarshalled (files reach 60MB+).
func parseClaudeSession(r io.Reader) (Session, bool) {
	var s Session
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
						s.Preview = oneLine(rec.LastPrompt)
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
	s.Title = orDefault(custom, orDefault(ai, first))
	s.Preview = orDefault(s.Preview, first)
	return s, s.Cwd != ""
}

// promptText: the typed prompt, or "" for tool results and <command-…> wrappers.
func promptText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) != nil {
		var blocks []struct{ Type, Text string }
		json.Unmarshal(raw, &blocks)
		for _, b := range blocks {
			if b.Type == "text" {
				text = b.Text
				break
			}
		}
	}
	text = oneLine(text)
	if strings.HasPrefix(text, "<") {
		return ""
	}
	return text
}

// allSessions: every provider, newest first, with live/busy filled in.
func allSessions(cwd string) []Session {
	var ss []Session
	for _, s := range claudeIndex.Sessions() {
		if cwd == "" || s.Cwd == cwd {
			ss = append(ss, s)
		}
	}
	ss = append(ss, codexSessions(cwd)...)
	busy := claudeBusy()
	live := map[string]string{}
	for _, t := range listThreads() {
		live[t.ID], live[t.State().Session] = t.ID, t.ID
	}
	for i := range ss {
		ss[i].Live = live[ss[i].ID]
		ss[i].Busy = ss[i].Provider == Claude && busy[ss[i].ID] && ss[i].Live == ""
	}
	sort.Slice(ss, func(i, j int) bool { return ss[i].LastActive.After(ss[j].LastActive) })
	return ss
}

func (s *server) sessions(w http.ResponseWriter, r *http.Request) {
	cwd := r.URL.Query().Get("cwd")
	if !inHome(cwd) {
		http.Error(w, "cwd must be inside your home folder", http.StatusBadRequest)
		return
	}
	writeJSON(w, orEmpty(allSessions(cwd)))
}

// projects: folders sessions ran in (gone or outside $HOME hidden), plus folders
// with only an open thread or terminal; most recently active first.
func (s *server) projects(w http.ResponseWriter, r *http.Request) {
	by := map[string]*Project{}
	get := func(cwd string) *Project {
		p := by[cwd]
		if p == nil {
			p = &Project{Cwd: cwd, Name: filepath.Base(cwd)}
			by[cwd] = p
		}
		return p
	}
	for _, ss := range allSessions("") {
		p := get(ss.Cwd)
		p.Sessions++
		if ss.LastActive.After(p.LastActive) {
			p.LastActive = ss.LastActive
		}
	}
	for _, t := range listThreads() {
		get(t.State().Cwd).Live++
	}
	for _, tm := range listTerms() {
		get(tm.Cwd).Live++
	}
	out := []Project{}
	for cwd, p := range by {
		if inHome(cwd) && isDir(cwd) {
			out = append(out, *p)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if (out[i].Live > 0) != (out[j].Live > 0) {
			return out[i].Live > 0
		}
		return out[i].LastActive.After(out[j].LastActive)
	})
	writeJSON(w, out)
}

// Package artifacts: HTML pages an agent shows on the phone. The agent calls
// show_artifact with a file in its project (edit it and reopen to see the new
// version) or with the HTML itself (kept here, so a read-only agent can show
// one too). The thread gets a card; opening it asks for a link, a random path
// a browser opens like a dev-server preview. The page is served with a CSP
// sandbox: an opaque origin with scripts but no cookies, storage, forms or
// popups, so it can't act as the phone or reach Luther's API.
package artifacts

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/text"
)

const (
	MaxSize = 5 << 20
	linkTTL = 30 * time.Minute
	keep    = 30 * 24 * time.Hour
)

// Artifact: what the server remembers about one card.
type Artifact struct {
	Title string `json:"title"`
	File  string `json:"file"` // absolute; a project file, or one under Dir()
	Saved int64  `json:"saved"`
}

var state = struct {
	sync.Mutex
	index map[string]Artifact // id → artifact (persisted)
	links map[string]link     // token → link
}{links: map[string]link{}}

type link struct {
	id      string
	expires time.Time
}

func Dir() string       { return filepath.Join(config.Dir(), "artifacts") }
func indexPath() string { return filepath.Join(Dir(), "index.json") }

// ID: the card's id for the arguments an agent passed. The adapters compute it
// from the same arguments when they replay a conversation, so a card keeps its
// id (and stays openable) across a server restart.
func ID(title, path, html string) string {
	h := sha256.Sum256([]byte(title + "\x00" + path + "\x00" + html))
	return "art-" + hex.EncodeToString(h[:8])
}

// Save checks and records what show_artifact asked for. path is relative to
// cwd (or absolute inside it); html is the page itself. Exactly one of them.
func Save(cwd, title, path, html string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return "", errors.New("title is required")
	}
	if (path == "") == (html == "") {
		return "", errors.New("pass either path (an .html file in your working folder) or html (the page itself)")
	}
	id := ID(title, path, html)
	var file string
	if html != "" {
		if len(html) > MaxSize {
			return "", fmt.Errorf("the page is %d bytes; the limit is %d", len(html), MaxSize)
		}
		if err := os.MkdirAll(Dir(), 0o700); err != nil {
			return "", err
		}
		file = filepath.Join(Dir(), id+".html")
		if err := os.WriteFile(file, []byte(html), 0o600); err != nil {
			return "", err
		}
	} else {
		var err error
		if file, err = projectFile(cwd, path); err != nil {
			return "", err
		}
	}
	state.Lock()
	defer state.Unlock()
	load()
	state.index[id] = Artifact{Title: title, File: file, Saved: time.Now().UnixMilli()}
	return id, save()
}

// projectFile: path resolved inside cwd, an .html/.htm file of at most MaxSize.
func projectFile(cwd, path string) (string, error) {
	if !paths.ProjectDir(cwd) {
		return "", errors.New("the thread's folder isn't usable")
	}
	rel := path
	if filepath.IsAbs(path) {
		r, err := filepath.Rel(cwd, path)
		if err != nil || r == ".." || strings.HasPrefix(r, "../") {
			return "", errors.New("the file must be inside your working folder " + cwd)
		}
		rel = r
	}
	abs, ok := paths.Within(cwd, rel)
	if !ok {
		return "", errors.New("the file must be inside your working folder " + cwd)
	}
	switch strings.ToLower(filepath.Ext(abs)) {
	case ".html", ".htm":
	default:
		return "", errors.New("the file must be .html or .htm")
	}
	fi, err := os.Stat(abs)
	switch {
	case err != nil:
		return "", fmt.Errorf("no such file: %s", path)
	case !fi.Mode().IsRegular():
		return "", errors.New("not a regular file: " + path)
	case fi.Size() > MaxSize:
		return "", fmt.Errorf("the file is %d bytes; the limit is %d", fi.Size(), MaxSize)
	}
	return abs, nil
}

// load: the index from disk, once. Caller holds state.
func load() {
	if state.index != nil {
		return
	}
	state.index = map[string]Artifact{}
	if b, err := os.ReadFile(indexPath()); err == nil {
		json.Unmarshal(b, &state.index)
	}
}

// save: caller holds state.
func save() error {
	if err := os.MkdirAll(Dir(), 0o700); err != nil {
		return err
	}
	b, _ := json.Marshal(state.index)
	tmp := indexPath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, indexPath())
}

// Prune forgets cards older than 30 days and deletes the pages kept here.
func Prune() {
	state.Lock()
	defer state.Unlock()
	load()
	cut := time.Now().Add(-keep).UnixMilli()
	changed := false
	for id, a := range state.index {
		if a.Saved < cut {
			if filepath.Dir(a.File) == Dir() {
				os.Remove(a.File)
			}
			delete(state.index, id)
			changed = true
		}
	}
	if changed {
		save()
	}
}

// Routes: POST /artifacts/{id}/link (bearer-authed) and the open link paths.
func Routes(mux *http.ServeMux, wrap httpx.Wrap) {
	mux.HandleFunc("POST /artifacts/{id}/link", wrap(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		state.Lock()
		load()
		_, ok := state.index[id]
		tok := text.RandHex(16)
		if ok {
			now := time.Now()
			for t, l := range state.links {
				if now.After(l.expires) {
					delete(state.links, t)
				}
			}
			state.links[tok] = link{id, now.Add(linkTTL)}
		}
		state.Unlock()
		if !ok {
			http.Error(w, "This page is gone: Luther keeps artifacts for 30 days.", http.StatusNotFound)
			return
		}
		httpx.WriteJSON(w, map[string]string{"path": "/a/" + tok + "/"})
	}))
	// Reloadable for the link's 30 minutes, so an agent's edit shows on reload.
	mux.HandleFunc("GET /a/{token}/{$}", func(w http.ResponseWriter, r *http.Request) {
		state.Lock()
		l, ok := state.links[r.PathValue("token")]
		a := state.index[l.id]
		state.Unlock()
		if !ok || time.Now().After(l.expires) {
			http.Error(w, "This link expired. Open the page again from Luther.", http.StatusGone)
			return
		}
		b, err := os.ReadFile(a.File)
		if err != nil {
			http.Error(w, "The page's file is gone.", http.StatusNotFound)
			return
		}
		h := w.Header()
		h.Set("Content-Type", "text/html; charset=utf-8")
		h.Set("Content-Security-Policy", "sandbox allow-scripts")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-store")
		w.Write(b)
	})
}

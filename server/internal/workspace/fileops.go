package workspace

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/paths"
)

// File operations from the phone: new folder, rename, upload, delete (to the
// Trash), pictures to show, and a search for @-mentions. Every path stays in
// the project, never .git, also through links.

const (
	maxUpload = 25 << 20
	maxImage  = 10 << 20
)

func fileRoutes(mux *http.ServeMux, wrap httpx.Wrap) {
	mux.HandleFunc("POST /files/mkdir", wrap(mkdir))
	mux.HandleFunc("POST /files/rename", wrap(rename))
	mux.HandleFunc("POST /files/upload", wrap(upload))
	mux.HandleFunc("DELETE /files", wrap(trash))
	mux.HandleFunc("GET /files/raw", wrap(raw))
	mux.HandleFunc("GET /files/search", wrap(search))
}

// target: rel inside cwd for a write (not the project itself, not .git); the
// nearest existing folder must resolve inside too (a link could point out).
func target(cwd, rel string) (string, error) {
	if !paths.ProjectDir(cwd) {
		return "", errors.New("cwd must be an existing folder inside your home folder")
	}
	clean := filepath.Clean("/" + rel)
	if clean == "/" || clean == "/.git" || strings.HasPrefix(clean, "/.git/") {
		return "", errors.New("can't change that path")
	}
	p, ok := paths.Within(cwd, clean)
	anc := filepath.Dir(p)
	for !paths.IsDir(anc) && anc != cwd && anc != filepath.Dir(anc) {
		anc = filepath.Dir(anc)
	}
	if _, inside := paths.Within(cwd, strings.TrimPrefix(anc, cwd)); !ok || !inside {
		return "", errors.New("path escapes the project")
	}
	return p, nil
}

func mkdir(w http.ResponseWriter, r *http.Request) {
	var req struct{ Cwd, Path string }
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	p, err := target(req.Cwd, req.Path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if _, err := os.Lstat(p); err == nil {
		http.Error(w, "something with that name is already there", http.StatusConflict)
		return
	}
	if err := os.MkdirAll(p, 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
	}
}

func rename(w http.ResponseWriter, r *http.Request) {
	var req struct{ Cwd, From, To string }
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	from, err := target(req.Cwd, req.From)
	if err == nil {
		_, err = os.Lstat(from)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	to, err := target(req.Cwd, req.To)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if _, err := os.Lstat(to); err == nil {
		http.Error(w, "something with that name is already there", http.StatusConflict)
		return
	}
	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	if err := os.Rename(from, to); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
	}
}

// upload: POST /files/upload?cwd=&path=[&replace=1], the raw file as the body.
func upload(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	p, err := target(q.Get("cwd"), q.Get("path"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if fi, err := os.Lstat(p); err == nil && (fi.IsDir() || q.Get("replace") != "1") {
		http.Error(w, "a file with that name is already there", http.StatusConflict)
		return
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	tmp, err := writeTemp(p, http.MaxBytesReader(w, r.Body, maxUpload), 0o644, 0)
	if err == nil {
		err = os.Rename(tmp, p)
	}
	if err != nil {
		os.Remove(tmp)
		http.Error(w, err.Error(), http.StatusBadRequest)
	}
}

// trash: DELETE /files?cwd=&path=: into the Trash, not gone.
func trash(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	p, err := target(q.Get("cwd"), q.Get("path"))
	if err == nil {
		_, err = os.Lstat(p)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := toTrash(p); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
	}
}

// toTrash moves p into the user's Trash folder (~/.Trash on macOS, the
// freedesktop one elsewhere), renamed if the name is taken.
func toTrash(p string) error {
	if runtime.GOOS == "darwin" {
		return moveInto(filepath.Join(paths.Home, ".Trash"), p)
	}
	return moveInto(filepath.Join(paths.Home, ".local", "share", "Trash", "files"), p)
}

// writeTemp writes body to a new, randomly named file beside p (never an
// existing file or a planted link) and returns its path, to rename over p.
// It fails when fewer than min bytes came (min < 0: any size).
func writeTemp(p string, body io.Reader, mode os.FileMode, min int64) (string, error) {
	f, err := os.CreateTemp(filepath.Dir(p), ".luther-*")
	if err != nil {
		return "", err
	}
	n, err := io.Copy(f, body)
	if err == nil && n <= min {
		err = errors.New("the file is empty")
	}
	if err == nil {
		err = f.Chmod(mode)
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return f.Name(), err
}

func moveInto(dir, p string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	dst := filepath.Join(dir, filepath.Base(p))
	if _, err := os.Lstat(dst); err == nil {
		dst = filepath.Join(dir, fmt.Sprintf("%s %s", filepath.Base(p), time.Now().Format("15.04.05")))
	}
	return os.Rename(p, dst)
}

var imageTypes = map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".heic": "image/heic", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".bmp": "image/bmp"}

// raw: GET /files/raw?cwd=&path= → {type, data} (base64) for a picture, to show it.
func raw(w http.ResponseWriter, r *http.Request) {
	cwd, ok := projectDir(w, r)
	if !ok {
		return
	}
	p, ok := paths.Within(cwd, r.URL.Query().Get("path"))
	typ := imageTypes[strings.ToLower(filepath.Ext(p))]
	if !ok || typ == "" {
		http.Error(w, "only pictures can be shown", http.StatusBadRequest)
		return
	}
	fi, err := os.Stat(p)
	if err != nil || fi.IsDir() || fi.Size() > maxImage {
		http.Error(w, "no such picture (or it's over 10 MB)", http.StatusBadRequest)
		return
	}
	b, err := os.ReadFile(p)
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	httpx.WriteJSON(w, map[string]string{"type": typ, "data": base64.StdEncoding.EncodeToString(b)})
}

// search: GET /files/search?cwd=&q= → up to 20 project files matching q
// (git's file list when it's a repository, else a bounded walk).
func search(w http.ResponseWriter, r *http.Request) {
	cwd, ok := projectDir(w, r)
	if !ok {
		return
	}
	httpx.WriteJSON(w, Rank(listFiles(cwd), r.URL.Query().Get("q"), 20))
}

func listFiles(cwd string) []string {
	if out, err := git(cwd, "ls-files", "--cached", "--others", "--exclude-standard", "-z"); err == nil {
		files := strings.Split(strings.TrimSuffix(out, "\x00"), "\x00")
		return files[:min(len(files), 50000)]
	}
	var files []string
	filepath.WalkDir(cwd, func(p string, d os.DirEntry, err error) error {
		if err != nil || len(files) >= 20000 {
			return filepath.SkipDir
		}
		name := d.Name()
		if d.IsDir() && p != cwd && (strings.HasPrefix(name, ".") || name == "node_modules" || name == "dist" || name == "build" || strings.Count(strings.TrimPrefix(p, cwd), "/") > 6) {
			return filepath.SkipDir
		}
		if !d.IsDir() && !strings.HasPrefix(name, ".") {
			rel, _ := filepath.Rel(cwd, p)
			files = append(files, rel)
		}
		return nil
	})
	return files
}

// Rank: the files matching q best, at most n. A file name that starts with q
// beats one that contains it, which beats a path that contains it, which
// beats q's letters appearing in order; shorter paths first within each.
func Rank(files []string, q string, n int) []string {
	q = strings.ToLower(strings.TrimSpace(q))
	type hit struct {
		path  string
		score int
	}
	var hits []hit
	for _, f := range files {
		if f == "" {
			continue
		}
		lf := strings.ToLower(f)
		base := strings.ToLower(filepath.Base(f))
		s := 0
		switch {
		case q == "":
			s = 1
		case strings.HasPrefix(base, q):
			s = 4
		case strings.Contains(base, q):
			s = 3
		case strings.Contains(lf, q):
			s = 2
		case inOrder(lf, q):
			s = 1
		}
		if s > 0 {
			hits = append(hits, hit{f, s})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score != hits[j].score {
			return hits[i].score > hits[j].score
		}
		return len(hits[i].path) < len(hits[j].path)
	})
	out := []string{}
	for _, h := range hits[:min(len(hits), n)] {
		out = append(out, h.path)
	}
	return out
}

func inOrder(s, q string) bool {
	want := []rune(q)
	i := 0
	for _, c := range s {
		if i < len(want) && c == want[i] {
			i++
		}
	}
	return i == len(want)
}

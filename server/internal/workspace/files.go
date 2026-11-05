package workspace

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
)

// Package workspace: a project's files and git — browse and read files, status,
// diff, commit, push, pull requests, and Luther's per-thread worktrees. Every path
// is confined to the project folder (cwd), which must be under $HOME.

const maxFile = 512 << 10

// Routes: files, git status/diff/commit/push/pr, worktree removal.
func Routes(mux *http.ServeMux, wrap httpx.Wrap) {
	mux.HandleFunc("GET /files", wrap(files))
	mux.HandleFunc("PUT /files", wrap(writeFile))
	mux.HandleFunc("GET /git/status", wrap(gitStatus))
	mux.HandleFunc("GET /git/diff", wrap(gitDiff))
	mux.HandleFunc("POST /git/commit", wrap(gitCommit))
	mux.HandleFunc("POST /git/push", wrap(gitPush))
	mux.HandleFunc("POST /git/pr", wrap(gitPR))
	mux.HandleFunc("DELETE /git/worktree", wrap(removeWorktree))
}

func projectDir(w http.ResponseWriter, r *http.Request) (string, bool) {
	cwd := r.URL.Query().Get("cwd")
	if !paths.ProjectDir(cwd) {
		http.Error(w, "cwd must be an existing folder inside your home folder", http.StatusBadRequest)
		return "", false
	}
	return cwd, true
}

// files: GET /files?cwd=&path= → []protocol.FileEntry for a folder, protocol.FileContent for a file.
func files(w http.ResponseWriter, r *http.Request) {
	cwd, ok := projectDir(w, r)
	if !ok {
		return
	}
	p, ok := paths.Within(cwd, r.URL.Query().Get("path"))
	if !ok {
		http.Error(w, "path escapes the project", http.StatusBadRequest)
		return
	}
	fi, err := os.Stat(p)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	if fi.IsDir() {
		ents, err := os.ReadDir(p)
		if err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		out := []protocol.FileEntry{}
		for _, e := range ents {
			if e.Name() == ".git" || e.Name() == ".DS_Store" {
				continue
			}
			info, _ := e.Info()
			fe := protocol.FileEntry{Name: e.Name(), Dir: e.IsDir()}
			if info != nil && !e.IsDir() {
				fe.Size = info.Size()
			}
			out = append(out, fe)
		}
		sort.Slice(out, func(i, j int) bool {
			if out[i].Dir != out[j].Dir {
				return out[i].Dir
			}
			return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
		})
		httpx.WriteJSON(w, out)
		return
	}
	f, err := os.Open(p)
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	defer f.Close()
	buf := make([]byte, maxFile+1)
	n, _ := f.Read(buf)
	rel, _ := filepath.Rel(cwd, p)
	fc := protocol.FileContent{Path: rel, Trunc: n > maxFile}
	b := buf[:min(n, maxFile)]
	if bytes.IndexByte(b, 0) >= 0 {
		fc.Binary = true
	} else {
		fc.Text = strings.ToValidUTF8(string(b), "\uFFFD") // a cut can split a multi-byte rune
		if !fc.Trunc && utf8.Valid(b) {
			fc.Hash = hash(b)
		}
	}
	httpx.WriteJSON(w, fc)
}

func hash(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

// writeFile: PUT /files {cwd, path, text, base}. base is the hash of the version
// the phone edited ("" to create a new file): if the file changed since, nothing
// is written (409) so an agent's or your own edit on the Mac isn't lost. Writes
// are atomic and stay inside the project (never .git).
func writeFile(w http.ResponseWriter, r *http.Request) {
	var req struct{ Cwd, Path, Text, Base string }
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	if !paths.ProjectDir(req.Cwd) {
		http.Error(w, "cwd must be an existing folder inside your home folder", http.StatusBadRequest)
		return
	}
	rel := filepath.Clean("/" + req.Path)
	if rel == "/" || strings.HasPrefix(rel, "/.git/") || rel == "/.git" || len(req.Text) > maxFile {
		http.Error(w, "can't write that path (or it's over 512 KB)", http.StatusBadRequest)
		return
	}
	p, ok := paths.Within(req.Cwd, rel)
	// A new file's folders may not exist yet: the nearest one that does must
	// resolve inside the project too (a symlinked folder could point out).
	anc := filepath.Dir(p)
	for !paths.IsDir(anc) && anc != req.Cwd {
		anc = filepath.Dir(anc)
	}
	if _, inside := paths.Within(req.Cwd, strings.TrimPrefix(anc, req.Cwd)); !ok || !inside {
		http.Error(w, "path escapes the project", http.StatusBadRequest)
		return
	}
	mode := os.FileMode(0o644)
	cur, err := os.ReadFile(p)
	switch {
	case err == nil && req.Base == "":
		http.Error(w, "that file already exists; open it to edit", http.StatusConflict)
		return
	case err == nil && hash(cur) != req.Base:
		http.Error(w, "the file changed on the Mac since you opened it; reopen it to see the new version", http.StatusConflict)
		return
	case err != nil && !os.IsNotExist(err):
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	case os.IsNotExist(err) && req.Base != "":
		http.Error(w, "the file was deleted on the Mac since you opened it", http.StatusConflict)
		return
	}
	if fi, err := os.Stat(p); err == nil {
		mode = fi.Mode().Perm()
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	tmp := p + ".luther-tmp"
	if err := os.WriteFile(tmp, []byte(req.Text), mode); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	if err := os.Rename(tmp, p); err != nil {
		os.Remove(tmp)
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	httpx.WriteJSON(w, protocol.FileContent{Path: strings.TrimPrefix(rel, "/"), Text: req.Text, Hash: hash([]byte(req.Text))})
}

func git(cwd string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", cwd}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", &gitErr{strings.TrimSpace(string(out))}
	}
	return string(out), nil
}

type gitErr struct{ msg string }

func (e *gitErr) Error() string { return text.OrDefault(e.msg, "git failed") }

func gitStatus(w http.ResponseWriter, r *http.Request) {
	cwd, ok := projectDir(w, r)
	if !ok {
		return
	}
	out, err := git(cwd, "status", "--porcelain=v1", "-b", "-uall")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	st := protocol.GitStatus{Files: []protocol.GitChange{}, Worktree: IsWorktree(cwd)}
	for _, line := range strings.Split(strings.TrimRight(out, "\n"), "\n") {
		switch {
		case strings.HasPrefix(line, "## "):
			head := strings.TrimPrefix(line, "## ")
			if b, rest, ok := strings.Cut(head, "..."); ok {
				st.Branch = b
				st.Upstream, _, _ = strings.Cut(rest, " ")
				if m := aheadRe.FindStringSubmatch(rest); m != nil {
					st.Ahead, _ = strconv.Atoi(m[1])
				}
			} else {
				st.Branch, _, _ = strings.Cut(head, " ")
			}
		case len(line) > 3:
			path := line[3:]
			if _, to, ok := strings.Cut(path, " -> "); ok { // rename
				path = to
			}
			st.Files = append(st.Files, protocol.GitChange{Path: path, Status: line[:2]})
		}
	}
	httpx.WriteJSON(w, st)
}

// gitDiff: GET /git/diff?cwd=&path= → plain-text unified diff of the working tree
// against HEAD (one file, or everything). Untracked files show as additions.
func gitDiff(w http.ResponseWriter, r *http.Request) {
	cwd, ok := projectDir(w, r)
	if !ok {
		return
	}
	path := r.URL.Query().Get("path")
	abs := ""
	if path != "" {
		var ok bool
		if abs, ok = paths.Within(cwd, path); !ok {
			http.Error(w, "path escapes the project", http.StatusBadRequest)
			return
		}
	}
	args := []string{"diff", "HEAD", "--no-color"}
	if path != "" {
		args = append(args, "--", path)
	}
	out, err := git(cwd, args...)
	if err != nil { // no commits yet
		out, _ = git(cwd, append([]string{"diff", "--no-color"}, args[2:]...)...)
	}
	if path != "" && out == "" { // untracked file; --no-index exits 1 when files differ
		b, _ := exec.Command("git", "-C", cwd, "diff", "--no-color", "--no-index", "/dev/null", abs).Output()
		out = string(b)
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte(text.Clip(out, 2<<20)))
}

func gitCommit(w http.ResponseWriter, r *http.Request) {
	var req struct{ Cwd, Message string }
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	if !paths.ProjectDir(req.Cwd) || strings.TrimSpace(req.Message) == "" {
		http.Error(w, "need a project folder and a message", http.StatusBadRequest)
		return
	}
	if _, err := git(req.Cwd, "add", "-A"); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	out, err := git(req.Cwd, "commit", "-m", req.Message)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	httpx.WriteJSON(w, map[string]string{"output": strings.TrimSpace(out)})
}

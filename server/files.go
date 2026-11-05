package main

import (
	"bytes"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// Workbench: browse and read project files, git status / diff / commit. Every
// path is confined to the project folder (cwd), which must be under $HOME.

const maxFile = 512 << 10

func projectDir(w http.ResponseWriter, r *http.Request) (string, bool) {
	cwd := r.URL.Query().Get("cwd")
	if !inHome(cwd) || !isDir(cwd) {
		http.Error(w, "cwd must be an existing folder inside your home folder", http.StatusBadRequest)
		return "", false
	}
	return cwd, true
}

// files: GET /files?cwd=&path= → []FileEntry for a folder, FileContent for a file.
func (s *server) files(w http.ResponseWriter, r *http.Request) {
	cwd, ok := projectDir(w, r)
	if !ok {
		return
	}
	p, ok := within(cwd, r.URL.Query().Get("path"))
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
		out := []FileEntry{}
		for _, e := range ents {
			if e.Name() == ".git" || e.Name() == ".DS_Store" {
				continue
			}
			info, _ := e.Info()
			fe := FileEntry{Name: e.Name(), Dir: e.IsDir()}
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
		writeJSON(w, out)
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
	fc := FileContent{Path: rel, Trunc: n > maxFile}
	b := buf[:min(n, maxFile)]
	if bytes.IndexByte(b, 0) >= 0 {
		fc.Binary = true
	} else {
		fc.Text = strings.ToValidUTF8(string(b), "\uFFFD") // a cut can split a multi-byte rune
	}
	writeJSON(w, fc)
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

func (e *gitErr) Error() string { return orDefault(e.msg, "git failed") }

func (s *server) gitStatus(w http.ResponseWriter, r *http.Request) {
	cwd, ok := projectDir(w, r)
	if !ok {
		return
	}
	out, err := git(cwd, "status", "--porcelain=v1", "-b", "-uall")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	st := GitStatus{Files: []GitChange{}}
	for _, line := range strings.Split(strings.TrimRight(out, "\n"), "\n") {
		switch {
		case strings.HasPrefix(line, "## "):
			st.Branch, _, _ = strings.Cut(strings.TrimPrefix(line, "## "), "...")
		case len(line) > 3:
			path := line[3:]
			if _, to, ok := strings.Cut(path, " -> "); ok { // rename
				path = to
			}
			st.Files = append(st.Files, GitChange{Path: path, Status: line[:2]})
		}
	}
	writeJSON(w, st)
}

// gitDiff: GET /git/diff?cwd=&path= → plain-text unified diff of the working tree
// against HEAD (one file, or everything). Untracked files show as additions.
func (s *server) gitDiff(w http.ResponseWriter, r *http.Request) {
	cwd, ok := projectDir(w, r)
	if !ok {
		return
	}
	path := r.URL.Query().Get("path")
	abs := ""
	if path != "" {
		var ok bool
		if abs, ok = within(cwd, path); !ok {
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
	w.Write([]byte(clip(out, 2<<20)))
}

func (s *server) gitCommit(w http.ResponseWriter, r *http.Request) {
	var req struct{ Cwd, Message string }
	if !readJSON(w, r, &req) {
		return
	}
	if !inHome(req.Cwd) || !isDir(req.Cwd) || strings.TrimSpace(req.Message) == "" {
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
	writeJSON(w, map[string]string{"output": strings.TrimSpace(out)})
}

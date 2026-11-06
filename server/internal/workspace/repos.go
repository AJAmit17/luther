package workspace

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

func gitRepos(w http.ResponseWriter, r *http.Request) {
	cwd, ok := projectDir(w, r)
	if !ok {
		return
	}
	repos := []protocol.Repository{}
	add := func(dir string) {
		name, _ := filepath.Rel(cwd, dir)
		if name == "." || name == ".." || strings.HasPrefix(name, ".."+string(filepath.Separator)) {
			name = filepath.Base(dir)
		}
		repo := protocol.Repository{Cwd: dir, Name: name}
		if st, err := readStatus(dir); err == nil {
			repo.Branch, repo.Changes = st.Branch, len(st.Files)
		} else {
			repo.Error = err.Error()
		}
		repos = append(repos, repo)
	}
	if prefix, err := git(cwd, "rev-parse", "--show-prefix"); err == nil {
		root := filepath.Clean(cwd)
		for _, part := range strings.Split(strings.TrimSuffix(strings.TrimSuffix(prefix, "\n"), "/"), "/") {
			if part != "" {
				root = filepath.Dir(root)
			}
		}
		if !paths.ProjectDir(root) {
			http.Error(w, "repository root must be inside your home folder", http.StatusBadRequest)
			return
		}
		add(root)
	} else {
		visited := 0
		err := filepath.WalkDir(cwd, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			visited++
			if visited > 20000 {
				return fs.SkipAll
			}
			if !d.IsDir() {
				return nil
			}
			if p != cwd && (strings.HasPrefix(d.Name(), ".") || d.Name() == "node_modules" || d.Name() == "vendor" || d.Name() == "dist" || d.Name() == "build" || d.Name() == "Library") {
				return fs.SkipDir
			}
			rel, _ := filepath.Rel(cwd, p)
			if strings.Count(rel, string(filepath.Separator)) >= 4 {
				return fs.SkipDir
			}
			if _, err := os.Lstat(filepath.Join(p, ".git")); err == nil {
				if _, err := git(p, "rev-parse", "--show-toplevel"); err == nil {
					add(p)
				}
				return fs.SkipDir
			}
			return nil
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if visited > 20000 {
			http.Error(w, "workspace scan limit reached; choose a smaller folder", http.StatusBadRequest)
			return
		}
	}
	httpx.WriteJSON(w, repos)
}

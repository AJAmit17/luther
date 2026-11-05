package workspace

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/text"
)

var aheadRe = regexp.MustCompile(`ahead (\d+)`)

// gitPush: POST /git/push {cwd} — the current branch to origin, tracking it.
func gitPush(w http.ResponseWriter, r *http.Request) {
	var req struct{ Cwd string }
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	if !paths.ProjectDir(req.Cwd) {
		http.Error(w, "need a project folder", http.StatusBadRequest)
		return
	}
	out, err := git(req.Cwd, "push", "-u", "origin", "HEAD")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	httpx.WriteJSON(w, map[string]string{"output": strings.TrimSpace(out)})
}

// gitPR: POST /git/pr {cwd, title, body} → {url}. Pushes first; an existing PR
// for the branch is returned instead of a new one. Uses the Mac's `gh` login.
func gitPR(w http.ResponseWriter, r *http.Request) {
	var req struct{ Cwd, Title, Body string }
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	if !paths.ProjectDir(req.Cwd) || strings.TrimSpace(req.Title) == "" {
		http.Error(w, "need a project folder and a title", http.StatusBadRequest)
		return
	}
	if _, err := git(req.Cwd, "push", "-u", "origin", "HEAD"); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if url, err := gh(req.Cwd, "pr", "view", "--json", "url", "-q", ".url"); err == nil && url != "" {
		httpx.WriteJSON(w, map[string]string{"url": url, "existing": "true"})
		return
	}
	out, err := gh(req.Cwd, "pr", "create", "--title", req.Title, "--body", text.OrDefault(req.Body, "Opened from Luther."))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	lines := strings.Split(out, "\n")
	httpx.WriteJSON(w, map[string]string{"url": lines[len(lines)-1]})
}

func gh(cwd string, args ...string) (string, error) {
	cmd := exec.Command("gh", args...)
	cmd.Dir = cwd
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", errors.New(text.OrDefault(strings.TrimSpace(string(out)), "gh failed (is it installed and logged in on the Mac?)"))
	}
	return strings.TrimSpace(string(out)), nil
}

// ---- worktrees: one per thread, so parallel agents never share files ----

// WorktreesDir holds Luther's worktrees: <repo>-<id>, each on branch luther/<id>.
func WorktreesDir() string { return filepath.Join(config.Dir(), "worktrees") }

func IsWorktree(cwd string) bool {
	return strings.HasPrefix(filepath.Clean(cwd), WorktreesDir()+string(filepath.Separator))
}

// NewWorktree makes a worktree of cwd's repo at its HEAD, on a new branch, and
// returns its folder. The thread then runs there.
func NewWorktree(cwd string) (string, error) {
	root, err := git(cwd, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", fmt.Errorf("not a git repository: %w", err)
	}
	root = strings.TrimSpace(root)
	id := text.RandHex(3)
	dir := filepath.Join(WorktreesDir(), filepath.Base(root)+"-"+id)
	if err := os.MkdirAll(WorktreesDir(), 0o755); err != nil {
		return "", err
	}
	if _, err := git(root, "worktree", "add", "-b", "luther/"+id, dir, "HEAD"); err != nil {
		return "", err
	}
	// Keep the same relative folder if the thread was opened in a subfolder.
	if rel, err := filepath.Rel(root, cwd); err == nil && rel != "." && !strings.HasPrefix(rel, "..") {
		dir = filepath.Join(dir, rel)
	}
	return dir, nil
}

// Parent: the main checkout a Luther worktree belongs to ("" if cwd isn't one).
func Parent(cwd string) string {
	if !IsWorktree(cwd) {
		return ""
	}
	common, err := git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return ""
	}
	return filepath.Dir(strings.TrimSpace(common)) // …/repo/.git → …/repo
}

// Branch: the checked-out branch.
func Branch(cwd string) string {
	b, _ := git(cwd, "branch", "--show-current")
	return strings.TrimSpace(b)
}

// removeWorktree: DELETE /git/worktree?cwd=[&force=1]. Refuses uncommitted
// changes unless forced; the branch stays (push it or open a PR first).
func removeWorktree(w http.ResponseWriter, r *http.Request) {
	cwd := r.URL.Query().Get("cwd")
	if !IsWorktree(cwd) || !paths.IsDir(cwd) {
		http.Error(w, "not a Luther worktree", http.StatusBadRequest)
		return
	}
	root, err := git(cwd, "rev-parse", "--show-toplevel")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	args := []string{"worktree", "remove", strings.TrimSpace(root)}
	if r.URL.Query().Get("force") == "1" {
		args = append(args, "--force")
	}
	if _, err := git(Parent(cwd), args...); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
	}
}

package workspace

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
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

// Changes: how much cwd's checkout differs from its HEAD, new files included
// (they're marked intent-to-add, so use it on Luther's worktrees only).
func Changes(cwd string) (files, added, removed int) {
	git(cwd, "add", "-A", "-N")
	out, err := git(cwd, "diff", "HEAD", "--numstat")
	if err != nil {
		return 0, 0, 0
	}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		f := strings.Fields(line)
		if len(f) < 3 {
			continue
		}
		files++
		a, _ := strconv.Atoi(f[0]) // "-" for binary files
		r, _ := strconv.Atoi(f[1])
		added, removed = added+a, removed+r
	}
	return files, added, removed
}

// CarryOver applies a Luther worktree's uncommitted changes (new files
// included) to the checkout at dst, as uncommitted changes there. It changes
// nothing in dst unless the whole patch applies cleanly.
func CarryOver(worktree, dst string) error {
	if !IsWorktree(worktree) {
		return errors.New("not a Luther worktree")
	}
	src, err := git(worktree, "rev-parse", "--show-toplevel")
	if err != nil {
		return err
	}
	root, err := git(dst, "rev-parse", "--show-toplevel")
	if err != nil {
		return fmt.Errorf("not a git repository: %w", err)
	}
	src, root = strings.TrimSpace(src), strings.TrimSpace(root)
	git(src, "add", "-A", "-N")
	patch, err := git(src, "diff", "HEAD", "--binary")
	if err != nil {
		return err
	}
	if strings.TrimSpace(patch) == "" {
		return errors.New("that run changed nothing")
	}
	apply := func(check bool) error {
		args := []string{"-C", root, "apply", "--whitespace=nowarn"}
		if check {
			args = append(args, "--check")
		}
		cmd := exec.Command("git", args...)
		cmd.Stdin = strings.NewReader(patch)
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("its changes clash with your checkout (combine them with an agent instead): %s", text.Clip(strings.TrimSpace(string(out)), 400))
		}
		return nil
	}
	if err := apply(true); err != nil {
		return err
	}
	return apply(false)
}

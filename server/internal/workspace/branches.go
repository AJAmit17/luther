package workspace

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

// Branches, stashes, a stopped merge or rebase, and Luther's worktrees of a
// repository: what the phone's Changes screen does beyond commit and push.

var stashRe = regexp.MustCompile(`^stash@\{\d+\}$`)

func branchRoutes(mux *http.ServeMux, wrap httpx.Wrap) {
	mux.HandleFunc("GET /git/branches", wrap(gitBranches))
	mux.HandleFunc("POST /git/checkout", wrap(gitCheckout))
	mux.HandleFunc("POST /git/abort", wrap(gitAbort))
	mux.HandleFunc("POST /git/stash", wrap(gitStash))
	mux.HandleFunc("POST /git/stash/apply", wrap(gitStashApply))
	mux.HandleFunc("DELETE /git/stash", wrap(gitStashDrop))
	mux.HandleFunc("GET /git/worktrees", wrap(gitWorktrees))
	mux.HandleFunc("POST /git/worktree/bring", wrap(bringWorktree))
}

// readIn reads the request into v and checks *cwd (a field of v) is a project folder.
func readIn(w http.ResponseWriter, r *http.Request, v any, cwd *string) bool {
	if !httpx.ReadJSON(w, r, v) {
		return false
	}
	if !paths.ProjectDir(*cwd) {
		http.Error(w, "cwd must be an existing folder inside your home folder", http.StatusBadRequest)
		return false
	}
	return true
}

func fail(w http.ResponseWriter, err error) bool {
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return true
	}
	return false
}

func gitBranches(w http.ResponseWriter, r *http.Request) {
	cwd, ok := projectDir(w, r)
	if !ok {
		return
	}
	out := protocol.Branches{Branches: []protocol.GitBranch{}, Stashes: []protocol.Stash{}}
	cur, _ := git(cwd, "branch", "--show-current")
	out.Current = strings.TrimSpace(cur)
	refs, err := git(cwd, "for-each-ref", "--sort=-committerdate", "--format=%(refname:short)%00%(upstream:short)%00%(committerdate:unix)", "refs/heads")
	if fail(w, err) {
		return
	}
	for _, line := range strings.Split(strings.TrimSpace(refs), "\n") {
		f := strings.Split(line, "\x00")
		if len(f) == 3 && f[0] != "" {
			at, _ := strconv.ParseInt(f[2], 10, 64)
			out.Branches = append(out.Branches, protocol.GitBranch{Name: f[0], Upstream: f[1], Last: at * 1000})
		}
	}
	stashes, _ := git(cwd, "stash", "list", "--format=%gd%x00%gs%x00%ct")
	for _, line := range strings.Split(strings.TrimSpace(stashes), "\n") {
		f := strings.Split(line, "\x00")
		if len(f) == 3 {
			at, _ := strconv.ParseInt(f[2], 10, 64)
			out.Stashes = append(out.Stashes, protocol.Stash{Ref: f[0], Message: f[1], At: at * 1000})
		}
	}
	httpx.WriteJSON(w, out)
}

func gitCheckout(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Cwd, Branch string
		Create      bool
	}
	if !readIn(w, r, &req, &req.Cwd) {
		return
	}
	if _, err := git(req.Cwd, "check-ref-format", "--branch", req.Branch); err != nil || strings.HasPrefix(req.Branch, "-") {
		http.Error(w, "not a valid branch name", http.StatusBadRequest)
		return
	}
	args := []string{"switch", req.Branch}
	if req.Create {
		args = []string{"switch", "-c", req.Branch}
	}
	// git refuses when your changes would be overwritten: nothing is lost.
	_, err := git(req.Cwd, args...)
	fail(w, err)
}

// Operation: the stopped merge, rebase, cherry-pick or revert in cwd, if any.
func Operation(cwd string) string {
	for _, op := range []struct{ path, name string }{{"MERGE_HEAD", "merge"}, {"rebase-merge", "rebase"}, {"rebase-apply", "rebase"}, {"CHERRY_PICK_HEAD", "cherry-pick"}, {"REVERT_HEAD", "revert"}} {
		p, err := git(cwd, "rev-parse", "--git-path", op.path)
		if err != nil {
			return ""
		}
		p = strings.TrimSpace(p)
		if !filepath.IsAbs(p) {
			p = filepath.Join(cwd, p)
		}
		if _, err := os.Stat(p); err == nil {
			return op.name
		}
	}
	return ""
}

// gitAbort: give up the stopped merge, rebase, cherry-pick or revert.
func gitAbort(w http.ResponseWriter, r *http.Request) {
	var req struct{ Cwd string }
	if !readIn(w, r, &req, &req.Cwd) {
		return
	}
	op := Operation(req.Cwd)
	if op == "" {
		http.Error(w, "nothing to abort", http.StatusBadRequest)
		return
	}
	_, err := git(req.Cwd, op, "--abort")
	fail(w, err)
}

func gitStash(w http.ResponseWriter, r *http.Request) {
	var req struct{ Cwd, Message string }
	if !readIn(w, r, &req, &req.Cwd) {
		return
	}
	args := []string{"stash", "push", "--include-untracked"}
	if m := strings.TrimSpace(req.Message); m != "" {
		args = append(args, "-m", m)
	}
	_, err := git(req.Cwd, args...)
	fail(w, err)
}

func gitStashApply(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Cwd, Ref string
		Drop     bool
	}
	if !readIn(w, r, &req, &req.Cwd) {
		return
	}
	if !stashRe.MatchString(req.Ref) {
		http.Error(w, "not a stash", http.StatusBadRequest)
		return
	}
	verb := "apply"
	if req.Drop {
		verb = "pop" // kept if applying it conflicts
	}
	_, err := git(req.Cwd, "stash", verb, req.Ref)
	fail(w, err)
}

func gitStashDrop(w http.ResponseWriter, r *http.Request) {
	cwd, ok := projectDir(w, r)
	if !ok {
		return
	}
	ref := r.URL.Query().Get("ref")
	if !stashRe.MatchString(ref) {
		http.Error(w, "not a stash", http.StatusBadRequest)
		return
	}
	_, err := git(cwd, "stash", "drop", ref)
	fail(w, err)
}

// gitWorktrees: Luther's worktrees of cwd's repository, with how much each changed.
func gitWorktrees(w http.ResponseWriter, r *http.Request) {
	cwd, ok := projectDir(w, r)
	if !ok {
		return
	}
	main := cwd
	if p := Parent(cwd); p != "" {
		main = p
	}
	out, err := git(main, "worktree", "list", "--porcelain")
	if fail(w, err) {
		return
	}
	list := []protocol.WorktreeInfo{}
	var cur *protocol.WorktreeInfo
	for _, line := range strings.Split(out, "\n") {
		switch {
		case strings.HasPrefix(line, "worktree "):
			path := strings.TrimPrefix(line, "worktree ")
			cur = nil
			if IsWorktree(path) && paths.IsDir(path) {
				list = append(list, protocol.WorktreeInfo{Path: path})
				cur = &list[len(list)-1]
			}
		case strings.HasPrefix(line, "branch ") && cur != nil:
			cur.Branch = strings.TrimPrefix(strings.TrimPrefix(line, "branch "), "refs/heads/")
		}
	}
	for i := range list {
		list[i].Files, list[i].Added, list[i].Removed = Changes(list[i].Path)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Path < list[j].Path })
	httpx.WriteJSON(w, list)
}

// bringWorktree: a worktree's changes into its main checkout (uncommitted there).
func bringWorktree(w http.ResponseWriter, r *http.Request) {
	var req struct{ Cwd string }
	if !readIn(w, r, &req, &req.Cwd) {
		return
	}
	main := Parent(req.Cwd)
	if main == "" {
		fail(w, errors.New("not a Luther worktree"))
		return
	}
	fail(w, CarryOver(req.Cwd, main))
}

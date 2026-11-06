package workspace

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

func initRepo(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("git", "-C", dir, "init", "-b", "main").CombinedOutput(); err != nil {
		t.Fatalf("init: %v %s", err, out)
	}
}

func TestWorkspaceRepositories(t *testing.T) {
	paths.Home = t.TempDir()
	root := filepath.Join(paths.Home, "workspace")
	a, b := filepath.Join(root, "alpha"), filepath.Join(root, "group", "beta")
	initRepo(t, a)
	initRepo(t, b)
	initRepo(t, filepath.Join(root, "node_modules", "ignored"))
	outside := filepath.Join(paths.Home, "outside")
	initRepo(t, outside)
	os.Symlink(outside, filepath.Join(root, "escape"))
	os.WriteFile(filepath.Join(a, "new file.txt"), []byte("new\n"), 0o644)
	rec := httptest.NewRecorder()
	gitRepos(rec, httptest.NewRequest("GET", "/git/repos?cwd="+root, nil))
	var repos []protocol.Repository
	if err := json.Unmarshal(rec.Body.Bytes(), &repos); err != nil {
		t.Fatalf("%d %s: %v", rec.Code, rec.Body, err)
	}
	if len(repos) != 2 || repos[0].Cwd != a || repos[1].Cwd != b {
		t.Fatalf("repositories: %+v", repos)
	}
	if repos[0].Changes != 1 || repos[0].Branch != "main" {
		t.Fatalf("status: %+v", repos[0])
	}
	rec = httptest.NewRecorder()
	gitStatus(rec, httptest.NewRequest("GET", "/git/status?cwd="+a, nil))
	var st protocol.GitStatus
	json.Unmarshal(rec.Body.Bytes(), &st)
	if len(st.Files) != 1 || st.Files[0].Path != "new file.txt" {
		t.Fatalf("paths must be unquoted: %s", rec.Body)
	}
	rec = httptest.NewRecorder()
	gitRepos(rec, httptest.NewRequest("GET", "/git/repos?cwd="+b, nil))
	json.Unmarshal(rec.Body.Bytes(), &repos)
	if len(repos) != 1 || repos[0].Cwd != b {
		t.Fatalf("direct repository: %+v", repos)
	}
	sub := filepath.Join(b, "src", "nested")
	os.MkdirAll(sub, 0o755)
	rec = httptest.NewRecorder()
	gitRepos(rec, httptest.NewRequest("GET", "/git/repos?cwd="+sub, nil))
	json.Unmarshal(rec.Body.Bytes(), &repos)
	if len(repos) != 1 || repos[0].Cwd != b {
		t.Fatalf("subfolder must select the repository root: %+v", repos)
	}
}

func TestSelectedRepositoryMutation(t *testing.T) {
	paths.Home = t.TempDir()
	t.Setenv("GIT_AUTHOR_NAME", "Luther Test")
	t.Setenv("GIT_AUTHOR_EMAIL", "luther@test.invalid")
	t.Setenv("GIT_COMMITTER_NAME", "Luther Test")
	t.Setenv("GIT_COMMITTER_EMAIL", "luther@test.invalid")
	a, b := filepath.Join(paths.Home, "alpha"), filepath.Join(paths.Home, "beta")
	initRepo(t, a)
	initRepo(t, b)
	for _, dir := range []string{a, b} {
		os.WriteFile(filepath.Join(dir, "new file.txt"), []byte("new\n"), 0o644)
	}
	body, _ := json.Marshal(map[string]string{"cwd": b, "message": "test selected checkout"})
	rec := httptest.NewRecorder()
	gitCommit(rec, httptest.NewRequest("POST", "/git/commit", strings.NewReader(string(body))))
	if rec.Code != 200 {
		t.Fatalf("commit: %d %s", rec.Code, rec.Body)
	}
	if _, err := git(a, "rev-parse", "--verify", "HEAD"); err == nil {
		t.Fatal("other repository was committed")
	}
	if status, _ := readStatus(a); len(status.Files) != 1 {
		t.Fatalf("other checkout changed: %+v", status)
	}
	if status, _ := readStatus(b); len(status.Files) != 0 {
		t.Fatalf("selected checkout not committed: %+v", status)
	}
	worktree := filepath.Join(paths.Home, "worktree")
	if _, err := git(b, "worktree", "add", "-b", "test-worktree", worktree); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	gitRepos(rec, httptest.NewRequest("GET", "/git/repos?cwd="+worktree, nil))
	var repos []protocol.Repository
	json.Unmarshal(rec.Body.Bytes(), &repos)
	if len(repos) != 1 || repos[0].Branch != "test-worktree" {
		t.Fatalf("gitfile worktree: %s", rec.Body)
	}
}

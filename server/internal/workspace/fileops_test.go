package workspace

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

func serve(t *testing.T) (*http.ServeMux, string) {
	t.Helper()
	paths.Home = t.TempDir()
	proj := filepath.Join(paths.Home, "proj")
	os.MkdirAll(proj, 0o755)
	mux := http.NewServeMux()
	Routes(mux, func(h http.HandlerFunc) http.HandlerFunc { return h })
	return mux, proj
}

func do(mux *http.ServeMux, method, path string, body any) *httptest.ResponseRecorder {
	var b []byte
	switch v := body.(type) {
	case []byte:
		b = v
	case nil:
	default:
		b, _ = json.Marshal(v)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(method, path, bytes.NewReader(b)))
	return rec
}

func TestFileOps(t *testing.T) {
	mux, proj := serve(t)
	q := url.QueryEscape(proj)
	os.Symlink(paths.Home, filepath.Join(proj, "out"))

	if r := do(mux, "POST", "/files/mkdir", map[string]string{"cwd": proj, "path": "src/lib"}); r.Code != 200 {
		t.Fatalf("mkdir: %d %s", r.Code, r.Body)
	}
	for _, bad := range []string{".git/hooks", "out/escape", ""} {
		if r := do(mux, "POST", "/files/mkdir", map[string]string{"cwd": proj, "path": bad}); r.Code == 200 {
			t.Errorf("mkdir %q allowed", bad)
		}
	}
	if r := do(mux, "POST", "/files/upload?cwd="+q+"&path=src/a.txt", []byte("hello")); r.Code != 200 {
		t.Fatalf("upload: %d %s", r.Code, r.Body)
	}
	if r := do(mux, "POST", "/files/upload?cwd="+q+"&path=src/a.txt", []byte("again")); r.Code != http.StatusConflict {
		t.Fatalf("upload over a file without replace: %d", r.Code)
	}
	if r := do(mux, "POST", "/files/upload?cwd="+q+"&path=src/a.txt&replace=1", []byte("again")); r.Code != 200 {
		t.Fatalf("replace: %d", r.Code)
	}
	if r := do(mux, "POST", "/files/rename", map[string]string{"cwd": proj, "from": "src/a.txt", "to": "src/lib/b.txt"}); r.Code != 200 {
		t.Fatalf("rename: %d %s", r.Code, r.Body)
	}
	if b, _ := os.ReadFile(filepath.Join(proj, "src/lib/b.txt")); string(b) != "again" {
		t.Fatalf("renamed content: %q", b)
	}
	if r := do(mux, "POST", "/files/rename", map[string]string{"cwd": proj, "from": "src/lib/b.txt", "to": "out/stolen.txt"}); r.Code == 200 {
		t.Fatal("renamed out of the project")
	}
	if r := do(mux, "DELETE", "/files?cwd="+q+"&path=src/lib/b.txt", nil); r.Code != 200 {
		t.Fatalf("delete: %d %s", r.Code, r.Body)
	}
	if _, err := os.Stat(filepath.Join(proj, "src/lib/b.txt")); err == nil {
		t.Fatal("still there after delete")
	}
	trashed, _ := filepath.Glob(filepath.Join(paths.Home, ".Trash", "b.txt*"))
	trashed2, _ := filepath.Glob(filepath.Join(paths.Home, ".local/share/Trash/files", "b.txt*"))
	if len(trashed)+len(trashed2) != 1 {
		t.Fatal("deleted file isn't in the Trash")
	}

	png := []byte("\x89PNG\r\n\x1a\nfake")
	os.WriteFile(filepath.Join(proj, "pic.png"), png, 0o644)
	r := do(mux, "GET", "/files/raw?cwd="+q+"&path=pic.png", nil)
	if r.Code != 200 || !strings.Contains(r.Body.String(), `"image/png"`) {
		t.Fatalf("raw: %d %s", r.Code, r.Body)
	}
	if r := do(mux, "GET", "/files/raw?cwd="+q+"&path=src", nil); r.Code == 200 {
		t.Fatal("raw served a non-picture")
	}
}

func TestRank(t *testing.T) {
	files := []string{"src/components/Button.tsx", "src/button-utils.ts", "docs/about-buttons.md", "server/main.go", "src/bin/x.ts"}
	got := Rank(files, "butt", 10)
	if len(got) != 3 || got[0] != "src/button-utils.ts" || got[1] != "src/components/Button.tsx" {
		t.Fatalf("rank: %v", got)
	}
	if got := Rank(files, "smg", 10); len(got) != 1 || got[0] != "server/main.go" {
		t.Fatalf("in order: %v", got)
	}
	if got := Rank(files, "", 2); len(got) != 2 {
		t.Fatalf("empty query: %v", got)
	}
}

func TestBranchesStashAbort(t *testing.T) {
	mux, repo := serve(t)
	q := url.QueryEscape(repo)
	sh(t, repo, "init", "-q", "-b", "main")
	os.WriteFile(filepath.Join(repo, "f.txt"), []byte("base\n"), 0o644)
	sh(t, repo, "add", "-A")
	sh(t, repo, "commit", "-qm", "base")

	if r := do(mux, "POST", "/git/checkout", map[string]any{"cwd": repo, "branch": "feature", "create": true}); r.Code != 200 {
		t.Fatalf("create branch: %d %s", r.Code, r.Body)
	}
	if r := do(mux, "POST", "/git/checkout", map[string]any{"cwd": repo, "branch": "--evil"}); r.Code != http.StatusBadRequest {
		t.Fatalf("flag as branch: %d", r.Code)
	}
	var br protocol.Branches
	json.Unmarshal(do(mux, "GET", "/git/branches?cwd="+q, nil).Body.Bytes(), &br)
	if br.Current != "feature" || len(br.Branches) != 2 {
		t.Fatalf("branches: %+v", br)
	}

	os.WriteFile(filepath.Join(repo, "f.txt"), []byte("wip\n"), 0o644)
	os.WriteFile(filepath.Join(repo, "new.txt"), []byte("n\n"), 0o644)
	if r := do(mux, "POST", "/git/stash", map[string]any{"cwd": repo, "message": "my wip"}); r.Code != 200 {
		t.Fatalf("stash: %d %s", r.Code, r.Body)
	}
	json.Unmarshal(do(mux, "GET", "/git/branches?cwd="+q, nil).Body.Bytes(), &br)
	if len(br.Stashes) != 1 || !strings.Contains(br.Stashes[0].Message, "my wip") {
		t.Fatalf("stashes: %+v", br.Stashes)
	}
	if _, err := os.Stat(filepath.Join(repo, "new.txt")); err == nil {
		t.Fatal("stash left the untracked file")
	}
	if r := do(mux, "POST", "/git/stash/apply", map[string]any{"cwd": repo, "ref": "stash@{0}; rm -rf /"}); r.Code != http.StatusBadRequest {
		t.Fatalf("bad stash ref: %d", r.Code)
	}
	if r := do(mux, "POST", "/git/stash/apply", map[string]any{"cwd": repo, "ref": "stash@{0}", "drop": true}); r.Code != 200 {
		t.Fatalf("pop: %d %s", r.Code, r.Body)
	}
	if b, _ := os.ReadFile(filepath.Join(repo, "f.txt")); string(b) != "wip\n" {
		t.Fatalf("after pop: %q", b)
	}

	// A conflicting merge: the operation shows, and abort undoes it.
	sh(t, repo, "commit", "-qam", "feature change")
	sh(t, repo, "switch", "-q", "main")
	os.WriteFile(filepath.Join(repo, "f.txt"), []byte("main change\n"), 0o644)
	sh(t, repo, "commit", "-qam", "main change")
	if gitIgnoreErr(repo, "merge", "feature") == nil {
		t.Fatal("expected a conflict")
	}
	var st protocol.GitStatus
	json.Unmarshal(do(mux, "GET", "/git/status?cwd="+q, nil).Body.Bytes(), &st)
	if st.Operation != "merge" {
		t.Fatalf("operation: %+v", st)
	}
	if r := do(mux, "POST", "/git/abort", map[string]any{"cwd": repo}); r.Code != 200 {
		t.Fatalf("abort: %d %s", r.Code, r.Body)
	}
	if Operation(repo) != "" {
		t.Fatal("still merging after abort")
	}
}

func gitIgnoreErr(dir string, args ...string) error {
	_, err := git(dir, append([]string{"-c", "user.email=t@t", "-c", "user.name=t"}, args...)...)
	return err
}

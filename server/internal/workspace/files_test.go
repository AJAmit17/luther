package workspace

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/AJAmit17/luther/server/internal/paths"
)

func TestWriteFile(t *testing.T) {
	paths.Home = t.TempDir()
	proj := filepath.Join(paths.Home, "proj")
	outside := filepath.Join(paths.Home, "outside")
	os.MkdirAll(proj, 0o755)
	os.MkdirAll(outside, 0o755)
	os.Symlink(outside, filepath.Join(proj, "link"))
	os.WriteFile(filepath.Join(outside, "secret.md"), []byte("x"), 0o644)
	os.Symlink(filepath.Join(outside, "secret.md"), filepath.Join(proj, "filelink.md"))

	put := func(path, text, base string) (int, string) {
		b, _ := json.Marshal(map[string]string{"cwd": proj, "path": path, "text": text, "base": base})
		rec := httptest.NewRecorder()
		writeFile(rec, httptest.NewRequest("PUT", "/files", strings.NewReader(string(b))))
		var fc struct{ Hash string }
		json.Unmarshal(rec.Body.Bytes(), &fc)
		return rec.Code, fc.Hash
	}
	code, h1 := put(".claude/CLAUDE.md", "# rules\n", "")
	if code != 200 || h1 == "" {
		t.Fatalf("create: %d", code)
	}
	if code, _ := put(".claude/CLAUDE.md", "again", ""); code != http.StatusConflict {
		t.Errorf("create over existing: %d", code)
	}
	code, h2 := put(".claude/CLAUDE.md", "# rules v2\n", h1)
	if code != 200 || h2 == h1 {
		t.Fatalf("edit: %d", code)
	}
	if code, _ := put(".claude/CLAUDE.md", "stale", h1); code != http.StatusConflict {
		t.Errorf("stale edit: %d", code)
	}
	if b, _ := os.ReadFile(filepath.Join(proj, ".claude/CLAUDE.md")); string(b) != "# rules v2\n" {
		t.Errorf("content %q", b)
	}
	for _, bad := range []string{"link/new.md", "link/sub/new.md", "filelink.md", ".git/config"} {
		code, _ := put(bad, "pwned", "")
		if code == 200 {
			t.Errorf("%s: written", bad)
		}
	}
	if ents, _ := os.ReadDir(outside); len(ents) != 1 {
		t.Errorf("outside has %d files", len(ents))
	}
	// ".." can't climb out: it's clamped to the project root
	if code, _ := put("../outside/x.md", "ok", ""); code != 200 || !paths.IsFile(filepath.Join(proj, "outside/x.md")) {
		t.Errorf("clamped path: %d", code)
	}
}

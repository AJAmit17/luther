package paths

import (
	"os"
	"path/filepath"
	"testing"
)

// Private folders and symlinks out of home are refused.
func TestConfinement(t *testing.T) {
	Home = t.TempDir()
	outside := t.TempDir()
	os.MkdirAll(filepath.Join(Home, ".luther"), 0o700)
	os.MkdirAll(filepath.Join(Home, "proj"), 0o700)
	os.Symlink(outside, filepath.Join(Home, "proj", "out"))
	os.Symlink(filepath.Join(Home, ".luther"), filepath.Join(Home, "proj", "keys"))

	for p, want := range map[string]bool{
		filepath.Join(Home, "proj"):           true,
		filepath.Join(Home, ".luther"):        false,
		filepath.Join(Home, "proj", "out"):    false, // resolves outside home
		filepath.Join(Home, "proj", "keys"):   false, // resolves to ~/.luther
		filepath.Join(Home, ".ssh", "id_rsa"): false,
		"relative/path":                       false,
	} {
		if InHome(p) != want {
			t.Errorf("InHome(%s) = %v", p, !want)
		}
	}
	if _, ok := Within(Home, ".luther/config.json"); ok {
		t.Error("Within reached ~/.luther")
	}
	if _, ok := Within(filepath.Join(Home, "proj"), "keys/config.json"); ok {
		t.Error("Within followed a link into ~/.luther")
	}
	// Luther's worktrees are code: reachable. Its keys next to them are not,
	// also through a link planted in a worktree.
	wt := filepath.Join(Home, ".luther", "worktrees", "proj-ab12")
	os.MkdirAll(wt, 0o700)
	os.Symlink(filepath.Join(Home, ".luther"), filepath.Join(wt, "keys"))
	if !InHome(wt) || !ProjectDir(wt) {
		t.Error("a Luther worktree should be reachable")
	}
	for _, p := range []string{filepath.Join(Home, ".luther", "worktrees"), filepath.Join(wt, "..", "..", "config.json"), filepath.Join(wt, "keys")} {
		if InHome(p) {
			t.Errorf("InHome(%s) = true", p)
		}
	}
	if _, ok := Within(wt, "keys/config.json"); ok {
		t.Error("Within followed a worktree link into ~/.luther")
	}
	if _, ok := Within(filepath.Join(Home, "proj"), "src/main.go"); !ok {
		t.Error("Within refused a normal project file")
	}
}

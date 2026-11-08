package workspace

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/AJAmit17/luther/server/internal/paths"
)

func sh(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir, "-c", "user.email=t@t", "-c", "user.name=t"}, args...)...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
}

func TestCarryOver(t *testing.T) {
	paths.Home = t.TempDir()
	repo := filepath.Join(paths.Home, "repo")
	os.MkdirAll(repo, 0o755)
	sh(t, repo, "init", "-q", "-b", "main")
	os.WriteFile(filepath.Join(repo, "a.txt"), []byte("one\ntwo\n"), 0o644)
	sh(t, repo, "add", "-A")
	sh(t, repo, "commit", "-qm", "init")

	wt, err := NewWorktree(repo)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(wt, "a.txt"), []byte("one\nTWO\n"), 0o644)
	os.WriteFile(filepath.Join(wt, "new.txt"), []byte("fresh\n"), 0o644)
	if f, a, r := Changes(wt); f != 2 || a != 2 || r != 1 {
		t.Fatalf("changes: %d files +%d -%d", f, a, r)
	}

	// A clash leaves your checkout exactly as it was.
	os.WriteFile(filepath.Join(repo, "a.txt"), []byte("one\nmine\n"), 0o644)
	if err := CarryOver(wt, repo); err == nil {
		t.Fatal("a clashing patch was applied")
	}
	if b, _ := os.ReadFile(filepath.Join(repo, "a.txt")); string(b) != "one\nmine\n" {
		t.Fatalf("checkout changed: %q", b)
	}
	if _, err := os.Stat(filepath.Join(repo, "new.txt")); err == nil {
		t.Fatal("a failed carry-over left a new file")
	}

	sh(t, repo, "checkout", "--", "a.txt")
	if err := CarryOver(wt, repo); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(repo, "a.txt")); string(b) != "one\nTWO\n" {
		t.Fatalf("a.txt: %q", b)
	}
	if b, _ := os.ReadFile(filepath.Join(repo, "new.txt")); string(b) != "fresh\n" {
		t.Fatalf("new.txt: %q", b)
	}
	if err := CarryOver(repo, repo); err == nil {
		t.Fatal("carried over from a folder that isn't a Luther worktree")
	}
}

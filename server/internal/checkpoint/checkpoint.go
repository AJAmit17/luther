// Package checkpoint: per-turn snapshots of a git working tree. A snapshot
// writes the whole tree (tracked + untracked, .gitignore respected) as a git
// tree object through a throwaway index, so the user's index, stash and branches
// are never touched. Agent-agnostic: works for Claude and Codex alike.
package checkpoint

import (
	"errors"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
)

// Checkpoint: one turn — the tree before it (Start) and after it (End, once done).
type Checkpoint struct {
	protocol.Turn
	Root  string // repo toplevel
	Start string
	End   string
}

func gitTmp(root, index string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
	if index != "" {
		cmd.Env = append(os.Environ(), "GIT_INDEX_FILE="+index)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", errors.New(text.OrDefault(strings.TrimSpace(string(out)), "git failed"))
	}
	return strings.TrimSpace(string(out)), nil
}

func tmpIndex() (string, func(), error) {
	f, err := os.CreateTemp("", "luther-index-")
	if err != nil {
		return "", nil, err
	}
	idx := f.Name()
	f.Close()
	os.Remove(idx) // git wants to create it
	return idx, func() { os.Remove(idx) }, nil
}

// Snapshot writes the working tree under root as a tree object.
func Snapshot(root string) (string, error) {
	idx, done, err := tmpIndex()
	if err != nil {
		return "", err
	}
	defer done()
	if _, err := gitTmp(root, idx, "read-tree", "HEAD"); err != nil { // no commits yet
		if _, err := gitTmp(root, idx, "read-tree", "--empty"); err != nil {
			return "", err
		}
	}
	if _, err := gitTmp(root, idx, "add", "-A"); err != nil {
		return "", err
	}
	return gitTmp(root, idx, "write-tree")
}

// Begin snapshots cwd's repo before a turn; nil outside a repo or on failure
// (the turn runs anyway).
func Begin(cwd, prompt string) *Checkpoint {
	root, err := gitTmp(cwd, "", "rev-parse", "--show-toplevel")
	if err != nil {
		return nil
	}
	tree, err := Snapshot(root)
	if err != nil {
		return nil
	}
	return &Checkpoint{Turn: protocol.Turn{Prompt: text.OneLine(prompt), StartedAt: time.Now().UnixMilli()}, Root: root, Start: tree}
}

// Changed: how many files differ between two trees.
func Changed(root, from, to string) int {
	out, err := gitTmp(root, "", "diff", "--name-only", from, to)
	if err != nil || out == "" {
		return 0
	}
	return len(strings.Split(out, "\n"))
}

func Diff(root, from, to string) (string, error) {
	return gitTmp(root, "", "diff", "--no-color", from, to)
}

// Restore makes the working tree match tree `to` (taken from tree `now`): files
// written from `to`, files only in `now` deleted. The real index is untouched.
func Restore(root, to, now string) error {
	idx, done, err := tmpIndex()
	if err != nil {
		return err
	}
	defer done()
	if _, err := gitTmp(root, idx, "read-tree", to); err != nil {
		return err
	}
	if _, err := gitTmp(root, idx, "checkout-index", "-a", "-f"); err != nil {
		return err
	}
	added, err := gitTmp(root, "", "diff", "--name-only", "--diff-filter=A", to, now)
	if err != nil {
		return err
	}
	for _, p := range strings.Split(added, "\n") {
		if p != "" {
			if full, ok := paths.Within(root, p); ok {
				os.Remove(full)
			}
		}
	}
	return nil
}

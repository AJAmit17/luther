// Package paths: every path a phone sends is checked here — absolute, under
// $HOME, and (for project files) inside the project.
package paths

import (
	"os"
	"path/filepath"
	"strings"
)

var Home, _ = os.UserHomeDir()

func InHome(p string) bool {
	if !filepath.IsAbs(p) {
		return false
	}
	p = filepath.Clean(p)
	return p == Home || strings.HasPrefix(p, Home+string(filepath.Separator))
}

func IsDir(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.IsDir()
}

func IsFile(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && !fi.IsDir()
}

// Within resolves rel under root, refusing escapes (.., absolute, symlinks out).
func Within(root, rel string) (string, bool) {
	p := filepath.Join(root, filepath.Clean("/"+rel))
	if real, err := filepath.EvalSymlinks(p); err == nil {
		rootReal, _ := filepath.EvalSymlinks(root)
		if real != rootReal && !strings.HasPrefix(real, rootReal+string(filepath.Separator)) {
			return "", false
		}
	}
	return p, true
}

// ProjectDir: the folder a request names, if it's an existing folder under $HOME.
func ProjectDir(p string) bool { return InHome(p) && IsDir(p) }

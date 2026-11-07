// Package paths: every path a phone sends is checked here — absolute, under
// $HOME, and (for project files) inside the project.
package paths

import (
	"os"
	"path/filepath"
	"strings"
)

var Home, _ = os.UserHomeDir()

// InHome: p is under $HOME, also once its symlinks are resolved, and not in
// a private folder.
func InHome(p string) bool {
	if !filepath.IsAbs(p) {
		return false
	}
	p = resolve(filepath.Clean(p)) // a link inside home must not lead out of it
	return under(p, realHome()) && !Private(p)
}

// Private: folders a phone never reaches through Luther's own file, git and
// terminal routes: Luther's keys and tokens, SSH and GPG keys, keychains,
// cloud credentials. (An agent the phone runs is another matter: it acts
// with your rights.)
func Private(p string) bool {
	home := realHome()
	p = resolve(p)
	for _, d := range []string{".luther", ".ssh", ".gnupg", ".aws", filepath.Join("Library", "Keychains")} {
		if under(p, filepath.Join(home, d)) {
			return true
		}
	}
	return false
}

func under(p, root string) bool {
	return p == root || strings.HasPrefix(p, root+string(filepath.Separator))
}

// resolve: p with its symlinks resolved, through its nearest existing
// ancestor when p itself doesn't exist yet (a file about to be written).
func resolve(p string) string {
	rest := ""
	for q := p; ; q = filepath.Dir(q) {
		if real, err := filepath.EvalSymlinks(q); err == nil {
			return filepath.Join(real, rest)
		}
		if q == filepath.Dir(q) {
			return p
		}
		rest = filepath.Join(filepath.Base(q), rest)
	}
}

func realHome() string {
	if real, err := filepath.EvalSymlinks(Home); err == nil {
		return real
	}
	return Home
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
		if !under(real, rootReal) {
			return "", false
		}
	}
	if Private(p) {
		return "", false
	}
	return p, true
}

// ProjectDir: the folder a request names, if it's an existing folder under $HOME.
func ProjectDir(p string) bool { return InHome(p) && IsDir(p) }

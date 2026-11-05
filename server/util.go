package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

var (
	home, _ = os.UserHomeDir()
	uuidRe  = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v); err != nil {
		http.Error(w, "bad json: "+err.Error(), http.StatusBadRequest)
		return false
	}
	return true
}

func orEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}

func oneLine(s string) string { return clip(strings.Join(strings.Fields(s), " "), 120) }

func orDefault(s, d string) string {
	if strings.TrimSpace(s) == "" {
		return d
	}
	return s
}

func randHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}

func newUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// inHome: every path a phone sends must be an absolute path under $HOME.
func inHome(p string) bool {
	if !filepath.IsAbs(p) {
		return false
	}
	p = filepath.Clean(p)
	return p == home || strings.HasPrefix(p, home+string(filepath.Separator))
}

func isDir(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.IsDir()
}

// within: rel resolved under root, refusing escapes (.., absolute, symlinks out).
func within(root, rel string) (string, bool) {
	p := filepath.Join(root, filepath.Clean("/"+rel))
	if real, err := filepath.EvalSymlinks(p); err == nil {
		rootReal, _ := filepath.EvalSymlinks(root)
		if real != rootReal && !strings.HasPrefix(real, rootReal+string(filepath.Separator)) {
			return "", false
		}
	}
	return p, true
}

// loginPath adopts the login shell's PATH: launchd starts us with /usr/bin:/bin,
// which finds neither claude, codex nor tmux. Children inherit it.
func loginPath() {
	sh := orDefault(os.Getenv("SHELL"), "/bin/zsh")
	out, err := exec.Command(sh, "-ilc", `printf '\n__LUTHER__%s__LUTHER__' "$PATH"`).Output()
	if _, rest, ok := strings.Cut(string(out), "__LUTHER__"); err == nil && ok {
		if p, _, ok := strings.Cut(rest, "__LUTHER__"); ok && p != "" {
			os.Setenv("PATH", p)
		}
	}
	for _, bin := range []string{"claude", "codex", "tmux", "git"} {
		if _, err := exec.LookPath(bin); err != nil {
			log.Printf("note: %s not found on PATH", bin)
		}
	}
}

// cleanEnv drops vars that make a spawned agent think it's nested inside another
// session (e.g. when `luther serve` was started from inside Claude Code).
func cleanEnv() {
	for _, kv := range os.Environ() {
		k, _, _ := strings.Cut(kv, "=")
		if k == "CLAUDECODE" || strings.HasPrefix(k, "CLAUDE_CODE_") || k == "CODEX_SANDBOX" || k == "CODEX_THREAD_ID" {
			os.Unsetenv(k)
		}
	}
}

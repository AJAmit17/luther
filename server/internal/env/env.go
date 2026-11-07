// Package env: the process environment agents run in under launchd.
package env

import (
	"bytes"
	"log"
	"os"
	"os/exec"
	"regexp"
	"strings"

	"github.com/AJAmit17/luther/server/internal/text"
)

// LoginPath adopts the login shell's PATH: launchd starts us with /usr/bin:/bin,
// which finds neither claude, codex nor tmux. Children inherit it.
func LoginPath() {
	sh := text.OrDefault(os.Getenv("SHELL"), "/bin/zsh")
	out, err := exec.Command(sh, "-ilc", `printf '\n__LUTHER__%s__LUTHER__' "$PATH"`).Output()
	if _, rest, ok := strings.Cut(string(out), "__LUTHER__"); err == nil && ok {
		if p, _, ok := strings.Cut(rest, "__LUTHER__"); ok && p != "" {
			os.Setenv("PATH", p)
		}
	}
	for _, bin := range []string{"claude", "codex", "tmux", "git", "gh"} {
		if _, err := exec.LookPath(bin); err != nil {
			log.Printf("note: %s not found on PATH", bin)
		}
	}
}

// CleanEnv drops vars that make a spawned agent think it's nested inside another
// session (e.g. when `luther serve` was started from inside Claude Code).
func CleanEnv() {
	for _, kv := range os.Environ() {
		k, _, _ := strings.Cut(kv, "=")
		if k == "CLAUDECODE" || strings.HasPrefix(k, "CLAUDE_CODE_") || k == "CODEX_SANDBOX" || k == "CODEX_THREAD_ID" {
			os.Unsetenv(k)
		}
	}
}

// LogTail: a child's stderr into the server log, one line at a time.
type LogTail struct {
	Prefix string
	buf    []byte
}

func (l *LogTail) Write(p []byte) (int, error) {
	l.buf = append(l.buf, p...)
	for {
		i := bytes.IndexByte(l.buf, '\n')
		if i < 0 {
			break
		}
		if line := string(l.buf[:i]); !chatter(line) {
			log.Print(l.Prefix + text.Clip(line, 500))
		}
		l.buf = l.buf[i+1:]
	}
	return len(p), nil
}

var ansiCodes = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// chatter: an agent's own INFO/DEBUG/TRACE log line. Left out of the server
// log, which keeps warnings, errors and anything unstructured.
func chatter(line string) bool {
	line = ansiCodes.ReplaceAllString(line, "")
	for _, lvl := range []string{" INFO ", " DEBUG ", " TRACE ", "[INFO]", "[DEBUG]", "level=info", "level=debug"} {
		if strings.Contains(line, lvl) {
			return true
		}
	}
	return false
}

// CapLog keeps a log file under max bytes: past it, its last quarter moves to
// <path>.1 (replacing the previous one) and the file starts over. Safe while
// launchd appends to it (O_APPEND writes land at the new end).
func CapLog(path string, max int64) {
	info, err := os.Stat(path)
	if err != nil || info.Size() <= max {
		return
	}
	f, err := os.Open(path)
	if err != nil {
		return
	}
	keep := max / 4
	tail := make([]byte, keep)
	n, _ := f.ReadAt(tail, info.Size()-keep)
	f.Close()
	if os.WriteFile(path+".1", tail[:n], 0o600) == nil {
		os.Truncate(path, 0)
	}
}

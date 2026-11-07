package env

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestCapLog(t *testing.T) {
	p := filepath.Join(t.TempDir(), "serve.log")
	os.WriteFile(p, bytes.Repeat([]byte("x"), 1000), 0o600)
	CapLog(p, 2000) // under the cap: untouched
	if info, _ := os.Stat(p); info.Size() != 1000 {
		t.Fatal("small log changed")
	}
	os.WriteFile(p, append(bytes.Repeat([]byte("a"), 3000), bytes.Repeat([]byte("z"), 500)...), 0o600)
	CapLog(p, 2000)
	if info, _ := os.Stat(p); info.Size() != 0 {
		t.Fatalf("not truncated: %d", info.Size())
	}
	if b, _ := os.ReadFile(p + ".1"); len(b) != 500 || b[0] != 'z' {
		t.Fatalf("tail kept wrong: %d bytes", len(b))
	}
}

func TestChatter(t *testing.T) {
	for line, want := range map[string]bool{
		"2026-11-06T14:01:31Z  INFO run_acp_server: close": true,
		"\x1b[2m2026\x1b[0m \x1b[32m INFO \x1b[0m x":       true,
		"2026-11-06T14:01:31Z  WARN remote config failed":  false,
		"ERROR failed to refresh available models":         false,
		"panic: something": false,
	} {
		if chatter(line) != want {
			t.Errorf("%q: want %v", line, want)
		}
	}
}

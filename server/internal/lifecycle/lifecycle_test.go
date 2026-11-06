package lifecycle

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/AJAmit17/luther/server/internal/paths"
)

func TestStartStop(t *testing.T) {
	paths.Home = t.TempDir()
	if runtime.GOOS != "darwin" {
		t.Skip("launchd")
	}
	old := run
	defer func() { run = old }()
	loaded := false
	starts, stops := 0, 0
	run = func(bin string, args ...string) ([]byte, error) {
		if bin != "launchctl" {
			t.Fatalf("unexpected command: %s", bin)
		}
		switch args[0] {
		case "print":
			if !loaded {
				return nil, errors.New("not loaded")
			}
		case "bootstrap":
			if strings.Contains(args[2], "Library/LaunchAgents") {
				t.Fatal("on-demand start must not install at login")
			}
			b, err := os.ReadFile(args[2])
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(b), "/test/a &amp; b/luther") || !strings.Contains(string(b), "<string>serve</string>") {
				t.Fatal(string(b))
			}
			loaded = true
			starts++
		case "bootout":
			loaded = false
			stops++
		default:
			t.Fatalf("unexpected launchctl args: %v", args)
		}
		return nil, nil
	}
	for range 2 {
		if err := Start("/test/a & b/luther"); err != nil {
			t.Fatal(err)
		}
	}
	if starts != 1 {
		t.Fatalf("started %d times", starts)
	}
	for range 2 {
		if err := Stop(); err != nil {
			t.Fatal(err)
		}
	}
	if stops != 1 {
		t.Fatalf("stopped %d times", stops)
	}
	if _, err := os.Stat(filepath.Join(paths.Home, "Library", "LaunchAgents")); !os.IsNotExist(err) {
		t.Fatal("start changed login services")
	}
}

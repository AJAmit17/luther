package cli

import (
	"bytes"
	"strings"
	"testing"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/charmbracelet/x/ansi"
)

func TestTerminalPanelAndPlainRendering(t *testing.T) {
	paths.Home = t.TempDir()
	for _, width := range []int{32, 40, 80} {
		var out bytes.Buffer
		p := presentation{out: &out, tty: true, color: true, width: width}
		p.panel("LUTHER / status", [][2]string{{"Server", "Running"}, {"Route", strings.Repeat("a", 90)}})
		if !strings.Contains(out.String(), "\x1b[") {
			t.Fatal("terminal renderer didn't apply styling")
		}
		if width >= 40 {
			for _, line := range strings.Split(out.String(), "\n") {
				if ansi.StringWidth(line) > width {
					t.Fatalf("panel overflowed %d columns: %q", width, line)
				}
			}
		}
	}
	var out bytes.Buffer
	p := newPresentation(&out, false)
	p.panel("LUTHER / status", [][2]string{{"Server", "Running"}})
	p.check(true, "server", "ready")
	p.qr("public-test-fixture")
	if strings.Contains(out.String(), "\x1b") {
		t.Fatal("ANSI codes leaked into plain output or QR")
	}
}

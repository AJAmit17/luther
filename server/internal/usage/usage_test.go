package usage

import (
	"testing"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

func TestLabel(t *testing.T) {
	for mins, want := range map[int]string{300: "5 hours", 10080: "7 days", 43200: "30 days", 60: "1 hour", 1440: "1 day", 90: "90 minutes", 0: "Window"} {
		if got := Label(mins); got != want {
			t.Errorf("Label(%d) = %q, want %q", mins, got, want)
		}
	}
}

func TestSetKeepsNewer(t *testing.T) {
	paths.Home = t.TempDir()
	turn := protocol.Limits{Provider: protocol.Claude, Account: "Desktop app", Updated: 2000, Windows: []protocol.Window{{Label: "5 hours", Used: 90}}}
	sample := protocol.Limits{Provider: protocol.Claude, Account: "Desktop app", Updated: 1000, Windows: []protocol.Window{{Label: "5 hours", Used: 0}}}
	Set(turn)
	Set(sample)
	if got := All(); len(got) != 1 || got[0].Windows[0].Used != 90 {
		t.Fatalf("older sample replaced the newer reading: %+v", got)
	}
}

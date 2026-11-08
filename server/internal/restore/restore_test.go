package restore

import (
	"testing"
	"time"
)

func TestDue(t *testing.T) {
	now := time.Now()
	ms := func(d time.Duration) int64 { return now.Add(-d).UnixMilli() }
	got := Due([]Entry{
		{Provider: "claude", Session: "a", Cwd: "/x", Saved: ms(time.Minute)},
		{Provider: "claude", Session: "a", Cwd: "/x", Saved: ms(time.Minute)},  // twice
		{Provider: "codex", Session: "b", Cwd: "/x", Saved: ms(3 * time.Hour)}, // too old
		{Provider: "codex", Session: "", Cwd: "/x", Saved: ms(time.Minute)},
		{Provider: "devin", Session: "c", Cwd: "/y", Saved: ms(time.Hour)},
	}, now)
	if len(got) != 2 || got[0].Session != "a" || got[1].Session != "c" {
		t.Fatalf("due: %+v", got)
	}
}

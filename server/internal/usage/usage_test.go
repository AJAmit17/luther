package usage

import "testing"

func TestLabel(t *testing.T) {
	for mins, want := range map[int]string{300: "5 hours", 10080: "7 days", 43200: "30 days", 60: "1 hour", 1440: "1 day", 90: "90 minutes", 0: "Window"} {
		if got := Label(mins); got != want {
			t.Errorf("Label(%d) = %q, want %q", mins, got, want)
		}
	}
}

package schedule

import (
	"testing"
	"time"
)

func TestCron(t *testing.T) {
	at := func(s string) time.Time { v, _ := time.ParseInLocation("2006-01-02 15:04", s, time.Local); return v }
	for _, c := range []struct {
		expr, now, next string
	}{
		{"0 9 * * *", "2026-11-06 08:30", "2026-11-06 09:00"},
		{"0 9 * * *", "2026-11-06 09:00", "2026-11-07 09:00"},
		{"@weekdays", "2026-11-06 10:00", "2026-11-09 09:00"}, // Fri → Mon
		{"*/15 * * * *", "2026-11-06 10:07", "2026-11-06 10:15"},
		{"30 2 1 * *", "2026-11-06 10:00", "2026-12-01 02:30"},
		{"0 0 * * 7", "2026-11-06 10:00", "2026-11-08 00:00"},   // 7 = Sunday
		{"0 12 13 * 5", "2026-11-06 13:00", "2026-11-13 12:00"}, // dom or dow
		{"5/20 8-9 * * *", "2026-11-06 08:06", "2026-11-06 08:25"},
	} {
		cr, err := Parse(c.expr)
		if err != nil {
			t.Fatalf("%s: %v", c.expr, err)
		}
		if got := cr.Next(at(c.now)); !got.Equal(at(c.next)) {
			t.Errorf("%s after %s = %s, want %s", c.expr, c.now, got.Format("2006-01-02 15:04"), c.next)
		}
	}
	for _, bad := range []string{"", "* * * *", "60 * * * *", "* 24 * * *", "*/0 * * * *", "a * * * *", "5-1 * * * *"} {
		if _, err := Parse(bad); err == nil {
			t.Errorf("%q parsed", bad)
		}
	}
}

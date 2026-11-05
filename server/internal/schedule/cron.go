package schedule

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Cron: a parsed five-field expression (minute hour day-of-month month
// day-of-week), with *, lists, ranges and steps, plus @hourly, @daily,
// @weekly, @weekdays. Day-of-month and day-of-week combine like cron: when
// both are restricted, either may match. Times are the server's local time.
type Cron struct {
	min, hour, dom, mon, dow [64]bool
	domAny, dowAny           bool
}

var macros = map[string]string{
	"@hourly":   "0 * * * *",
	"@daily":    "0 9 * * *",
	"@weekdays": "0 9 * * 1-5",
	"@weekly":   "0 9 * * 1",
}

func Parse(expr string) (*Cron, error) {
	expr = strings.TrimSpace(expr)
	if m, ok := macros[expr]; ok {
		expr = m
	}
	f := strings.Fields(expr)
	if len(f) != 5 {
		return nil, fmt.Errorf("want 5 fields (minute hour day month weekday), got %q", expr)
	}
	c := &Cron{domAny: f[2] == "*", dowAny: f[4] == "*"}
	for i, spec := range []struct {
		set    *[64]bool
		lo, hi int
		name   string
	}{{&c.min, 0, 59, "minute"}, {&c.hour, 0, 23, "hour"}, {&c.dom, 1, 31, "day"}, {&c.mon, 1, 12, "month"}, {&c.dow, 0, 7, "weekday"}} {
		if err := field(f[i], spec.lo, spec.hi, spec.set); err != nil {
			return nil, fmt.Errorf("%s: %w", spec.name, err)
		}
	}
	if c.dow[7] {
		c.dow[0] = true // 7 is Sunday too
	}
	return c, nil
}

func field(s string, lo, hi int, set *[64]bool) error {
	for _, part := range strings.Split(s, ",") {
		rng, stepS, hasStep := strings.Cut(part, "/")
		step := 1
		if hasStep {
			n, err := strconv.Atoi(stepS)
			if err != nil || n < 1 {
				return fmt.Errorf("bad step %q", stepS)
			}
			step = n
		}
		a, b := lo, hi
		if rng != "*" {
			x, y, isRange := strings.Cut(rng, "-")
			var err error
			if a, err = strconv.Atoi(x); err != nil {
				return fmt.Errorf("bad value %q", x)
			}
			b = a
			if isRange {
				if b, err = strconv.Atoi(y); err != nil {
					return fmt.Errorf("bad value %q", y)
				}
			} else if hasStep {
				b = hi // "5/15": from 5 to the end
			}
		}
		if a < lo || b > hi || a > b {
			return fmt.Errorf("%q is outside %d-%d", part, lo, hi)
		}
		for v := a; v <= b; v += step {
			set[v] = true
		}
	}
	return nil
}

// Match: t falls in a scheduled minute.
func (c *Cron) Match(t time.Time) bool {
	if !c.min[t.Minute()] || !c.hour[t.Hour()] || !c.mon[int(t.Month())] {
		return false
	}
	dom, dow := c.dom[t.Day()], c.dow[int(t.Weekday())]
	switch {
	case c.domAny && c.dowAny:
		return true
	case c.domAny:
		return dow
	case c.dowAny:
		return dom
	}
	return dom || dow
}

// Next: the first scheduled minute after t (zero if none within a year).
func (c *Cron) Next(t time.Time) time.Time {
	t = t.Truncate(time.Minute).Add(time.Minute)
	for i := 0; i < 366*24*60; i++ {
		if c.Match(t) {
			return t
		}
		t = t.Add(time.Minute)
	}
	return time.Time{}
}

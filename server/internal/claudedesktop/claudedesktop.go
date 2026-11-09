// Package claudedesktop: plan usage of the account the Claude desktop app is
// signed in to, which can differ from the claude CLI's login. The desktop app
// passes its own token to the Claude Code it runs (sessions still land in
// ~/.claude/projects); Luther doesn't read that token. It reads only the usage
// samples the app keeps for itself: 5-hour and 7-day percent, no reset times.
package claudedesktop

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/usage"
)

// Account labels the desktop app's entry in GET /usage.
const Account = "Desktop app"

// ReadLimits records the desktop app's latest usage sample. Nothing when the
// app isn't installed or is signed in to the CLI's own organization (its
// numbers are already shown under the CLI login).
func ReadLimits() error {
	b, err := os.ReadFile(filepath.Join(paths.Home, "Library", "Application Support", "Claude", "plan-usage-history.json"))
	if err != nil {
		return nil // no desktop app here
	}
	l, org, err := parse(b)
	if err != nil {
		return err
	}
	// ponytail: same organization taken as same account; two people on one
	// Team org would be folded together. Compare account ids if that comes up.
	if org != "" && org == cliOrg() {
		return nil
	}
	usage.Set(l)
	return nil
}

// parse: {"version": 2, "samples": [{"t": ms, "org": uuid, "u": {"fh": %, "sd": %}}]}
// → the newest sample, dated when the app took it.
func parse(b []byte) (protocol.Limits, string, error) {
	var h struct {
		Samples []struct {
			T   int64               `json:"t"`
			Org string              `json:"org"`
			U   map[string]*float64 `json:"u"`
		} `json:"samples"`
	}
	if err := json.Unmarshal(b, &h); err != nil {
		return protocol.Limits{}, "", errors.New("claude desktop usage: " + err.Error())
	}
	best := -1
	for i, s := range h.Samples {
		if best < 0 || s.T > h.Samples[best].T {
			best = i
		}
	}
	if best < 0 {
		return protocol.Limits{}, "", errors.New("claude desktop usage: no samples yet")
	}
	s := h.Samples[best]
	l := protocol.Limits{Provider: protocol.Claude, Account: Account, Updated: s.T}
	for _, w := range []struct{ k, label string }{{"fh", usage.Label(300)}, {"sd", usage.Label(10080)}} {
		if v := s.U[w.k]; v != nil {
			l.Windows = append(l.Windows, protocol.Window{Label: w.label, Used: *v})
		}
	}
	return l, s.Org, nil
}

// cliOrg: the organization the claude CLI is signed in to (~/.claude.json).
func cliOrg() string {
	b, err := os.ReadFile(filepath.Join(paths.Home, ".claude.json"))
	if err != nil {
		return ""
	}
	var c struct {
		OAuth struct {
			Org string `json:"organizationUuid"`
		} `json:"oauthAccount"`
	}
	json.Unmarshal(b, &c)
	return c.OAuth.Org
}

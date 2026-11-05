package codex

import (
	"encoding/json"

	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/usage"
)

// saveLimits: an account/rateLimits/read result or …/updated notification,
// both {rateLimits: {primary, secondary, planType}}.
func saveLimits(raw json.RawMessage) {
	type window struct {
		UsedPercent float64 `json:"usedPercent"`
		Mins        int     `json:"windowDurationMins"`
		ResetsAt    int64   `json:"resetsAt"` // seconds
	}
	var p struct {
		RateLimits struct {
			Primary, Secondary *window
			PlanType           string `json:"planType"`
		} `json:"rateLimits"`
	}
	if json.Unmarshal(raw, &p) != nil {
		return
	}
	l := protocol.Limits{Provider: protocol.Codex, Plan: p.RateLimits.PlanType}
	for _, w := range []*window{p.RateLimits.Primary, p.RateLimits.Secondary} {
		if w != nil {
			l.Windows = append(l.Windows, protocol.Window{Label: usage.Label(w.Mins), Used: w.UsedPercent, ResetsAt: w.ResetsAt * 1000})
		}
	}
	usage.Set(l)
}

// ReadLimits asks Codex for its current usage (starting the app-server if
// needed); the answer lands in package usage.
func ReadLimits() error {
	s, err := srv()
	if err != nil {
		return err
	}
	raw, err := s.Call("account/rateLimits/read", nil)
	if err == nil {
		saveLimits(raw)
	}
	return err
}

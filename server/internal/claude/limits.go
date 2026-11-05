package claude

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/usage"
)

// saveLimits: a rate_limit_event's rate_limit_info. Verified on 2.1.318:
// {unifiedWindows: {five_hour: {utilization 0–1, resetsAt s}, seven_day: …}}.
func saveLimits(raw json.RawMessage) {
	var info struct {
		Windows map[string]struct {
			Utilization float64 `json:"utilization"`
			ResetsAt    int64   `json:"resetsAt"`
		} `json:"unifiedWindows"`
	}
	if json.Unmarshal(raw, &info) != nil {
		return
	}
	mins := map[string]int{"five_hour": 300, "seven_day": 10080}
	l := protocol.Limits{Provider: protocol.Claude}
	for k, w := range info.Windows {
		label := strings.ReplaceAll(k, "_", " ")
		if m, ok := mins[k]; ok {
			label = usage.Label(m)
		}
		l.Windows = append(l.Windows, protocol.Window{Label: label, Used: w.Utilization * 100, ResetsAt: w.ResetsAt * 1000})
	}
	sort.Slice(l.Windows, func(i, j int) bool { return l.Windows[i].ResetsAt < l.Windows[j].ResetsAt })
	usage.Set(l)
}

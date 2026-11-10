package claude

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"time"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/AJAmit17/luther/server/internal/usage"
)

// saveLimits: a rate_limit_event's rate_limit_info, for the account the claude
// that sent it runs under. Verified on 2.1.318:
// {unifiedWindows: {five_hour: {utilization 0–1, resetsAt s}, seven_day: …}}.
func saveLimits(raw json.RawMessage, account string) {
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
	l := protocol.Limits{Provider: protocol.Claude, Account: account}
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

// ReadLimits reads Claude's plan usage from Anthropic's usage endpoint (what
// Claude Code's /usage and status line show), signed in as Claude Code is: its
// OAuth token from the login keychain (macOS) or ~/.claude/.credentials.json
// (Linux). The token is only read, never stored, logged or sent anywhere but
// api.anthropic.com; an expired one is left for Claude Code to refresh.
func ReadLimits() error {
	tok, err := oauthToken()
	if err != nil {
		return err
	}
	return ReadLimitsAs(tok, "")
}

// ReadLimitsAs: the same for one of Luther's Claude accounts (its token from
// `claude setup-token`). Such a token may lack the scope this endpoint asks
// for; that account's turns still report.
func ReadLimitsAs(tok, account string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.anthropic.com/api/oauth/usage", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("anthropic-beta", "oauth-2025-04-20")
	req.Header.Set("User-Agent", "luther")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("claude usage: %w", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != 200 {
		return fmt.Errorf("claude usage (%s): HTTP %d", text.OrDefault(account, "CLI login"), res.StatusCode)
	}
	return saveUsage(body, account)
}

// saveUsage: {"five_hour": {"utilization": 53, "resets_at": "…"}, "seven_day": …,
// other windows (some null)}; utilization in percent.
func saveUsage(body []byte, account string) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(body, &m); err != nil {
		return fmt.Errorf("claude usage: %w", err)
	}
	mins := map[string]int{"five_hour": 300, "seven_day": 10080}
	l := protocol.Limits{Provider: protocol.Claude, Account: account}
	for k, raw := range m {
		var w struct {
			Utilization *float64 `json:"utilization"`
			ResetsAt    string   `json:"resets_at"`
		}
		if json.Unmarshal(raw, &w) != nil || w.Utilization == nil {
			continue // null windows and non-window fields
		}
		label := strings.ReplaceAll(k, "_", " ")
		if n, ok := mins[k]; ok {
			label = usage.Label(n)
		} else if rest, ok := strings.CutPrefix(k, "seven_day_"); ok {
			label = "7 days · " + strings.ReplaceAll(rest, "_", " ")
		}
		win := protocol.Window{Label: label, Used: *w.Utilization}
		if t, err := time.Parse(time.RFC3339Nano, w.ResetsAt); err == nil {
			win.ResetsAt = t.UnixMilli()
		}
		l.Windows = append(l.Windows, win)
	}
	sort.Slice(l.Windows, func(i, j int) bool { return l.Windows[i].ResetsAt < l.Windows[j].ResetsAt }) // the 5-hour window first
	if len(l.Windows) == 0 {
		return errors.New("claude usage: no windows in the answer")
	}
	usage.Set(l)
	return nil
}

// oauthToken: Claude Code's access token, as it stored it.
func oauthToken() (string, error) {
	var raw []byte
	var err error
	if goruntime.GOOS == "darwin" {
		raw, err = exec.Command("security", "find-generic-password", "-s", "Claude Code-credentials", "-w").Output()
	} else {
		raw, err = os.ReadFile(filepath.Join(paths.Home, ".claude", ".credentials.json"))
	}
	if err != nil {
		return "", errors.New("claude usage: Claude Code's sign-in isn't readable here (signed in? on macOS, allow the keychain prompt)")
	}
	var c struct {
		OAuth struct {
			AccessToken string `json:"accessToken"`
			ExpiresAt   int64  `json:"expiresAt"`
		} `json:"claudeAiOauth"`
	}
	if json.Unmarshal(bytes.TrimSpace(raw), &c) != nil || c.OAuth.AccessToken == "" {
		return "", errors.New("claude usage: Claude Code isn't signed in with a plan")
	}
	if c.OAuth.ExpiresAt > 0 && time.Now().UnixMilli() > c.OAuth.ExpiresAt {
		return "", errors.New("claude usage: Claude Code's sign-in expired; it refreshes the next time Claude runs")
	}
	return c.OAuth.AccessToken, nil
}

package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"slices"
	"strings"
	"time"

	"github.com/AJAmit17/luther/server/internal/acp"
	"github.com/AJAmit17/luther/server/internal/env"
)

// agentBins: the agent CLIs Luther can run (Claude, Codex, every ACP agent, yours too).
func agentBins() []string {
	out := []string{"claude", "codex"}
	for _, a := range acp.Agents() {
		if !slices.Contains(out, a.Bins[0]) { // two entries can run one CLI
			out = append(out, a.Bins[0])
		}
	}
	return out
}

// Setup: from a fresh install to a pairing QR in one command. It finds your
// agents, starts the server, makes sure the phone has a route (an existing one
// that answers, else Tailscale Funnel, else a Cloudflare quick tunnel), checks
// the route answers, and prints the QR.
func (c *CLI) Setup() error {
	ok := c.view.check
	c.view.message("1. Agents", "")
	env.LoginPath()
	var found []string
	for _, bin := range agentBins() {
		if _, err := exec.LookPath(bin); err == nil {
			found = append(found, bin)
		}
	}
	ok(len(found) > 0, "agents", text(found, "none found: install Claude Code (npm i -g @anthropic-ai/claude-code) or Codex (npm i -g @openai/codex), then run luther setup again"))
	if len(found) == 0 {
		return fmt.Errorf("no agent CLI found")
	}

	c.view.message("2. Server", "")
	if err := c.Start(); err != nil {
		return err
	}

	c.view.message("3. Route for your phone", "")
	route, err := c.ensureRoute()
	if err != nil {
		return err
	}
	ok(true, "route", route)

	c.view.message("4. Pair", "")
	if err := c.Pair(false); err != nil {
		return err
	}
	fmt.Fprintln(c.out, "\n  Keep it running after a restart: luther service install")
	return nil
}

func text(list []string, none string) string {
	if len(list) == 0 {
		return none
	}
	return strings.Join(list, ", ")
}

// ensureRoute: a configured route that answers, else a new one.
func (c *CLI) ensureRoute() (string, error) {
	for _, u := range c.cfg.Routes() {
		if answers(u, 6*time.Second) {
			return u, nil
		}
		c.view.check(false, "route", u+" doesn't answer; trying another")
	}
	if tailscaleUp() {
		err := c.Tailscale(8443, false, true)
		if err == nil && answers(c.cfg.Tailnet, 30*time.Second) {
			return c.cfg.Tailnet, nil
		}
		c.view.check(false, "funnel", "Tailscale Funnel didn't come up"+errText(err))
	}
	if _, err := exec.LookPath("cloudflared"); err == nil {
		if err := c.QuickTunnel(false); err != nil {
			return "", err
		}
		for _, u := range c.cfg.Routes() {
			if strings.Contains(u, "trycloudflare.com") && answers(u, 45*time.Second) {
				return u, nil
			}
		}
		return "", fmt.Errorf("the quick tunnel started but doesn't answer yet; run luther doctor in a minute")
	}
	return "", fmt.Errorf("no way to reach this Mac from your phone: install cloudflared (brew install cloudflared, no account) or Tailscale, then run luther setup again")
}

func errText(err error) string {
	if err == nil {
		return ""
	}
	return ": " + err.Error()
}

func tailscaleUp() bool {
	out, err := exec.Command("tailscale", "status", "--json").Output()
	if err != nil {
		return false
	}
	var st struct{ BackendState string }
	return json.Unmarshal(out, &st) == nil && st.BackendState == "Running"
}

// probeClient looks names up itself (Go's resolver), not through the system's:
// macOS caches "no such host" for a new tunnel's name if asked before
// Cloudflare published it, and then every check fails for minutes.
var probeClient = &http.Client{Transport: &http.Transport{
	DialContext:         (&net.Dialer{Timeout: 5 * time.Second, Resolver: &net.Resolver{PreferGo: true}}).DialContext,
	TLSHandshakeTimeout: 5 * time.Second,
}}

// answers: u/healthz returns 200 within wait (a new tunnel takes a few seconds).
func answers(u string, wait time.Duration) bool {
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	for {
		req, _ := http.NewRequestWithContext(ctx, "GET", u+"/healthz", nil)
		if res, err := probeClient.Do(req); err == nil {
			res.Body.Close()
			if res.StatusCode == 200 {
				return true
			}
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(2 * time.Second):
		}
	}
}

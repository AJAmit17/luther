package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"
	"time"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/env"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/tunnel"
	"github.com/charmbracelet/x/ansi"
)

// Package cli: the commands on the machine running the agents — pair, tailscale, tunnel, service, doctor.
// They talk to the running server with the admin token from the config, or edit
// that config and launchd.

// CLI: the commands, over one loaded config.
type CLI struct {
	cfg  *config.Config
	out  io.Writer
	view presentation
}

func New(cfg *config.Config) *CLI {
	return &CLI{cfg: cfg, out: os.Stdout, view: newPresentation(os.Stdout, false)}
}

func (c *CLI) localURL() string { return fmt.Sprintf("http://127.0.0.1:%d", c.cfg.Port) }

func (c *CLI) adminPost(path string) (*http.Response, error) {
	req, _ := http.NewRequest("POST", c.localURL()+path, nil)
	req.Header.Set("Authorization", "Bearer "+c.cfg.AdminToken)
	return (&http.Client{Timeout: 5 * time.Second}).Do(req)
}

// Pair prints a QR the phone scans once: name, routes, one-time code. With
// --json it prints only the payload (for `luther remote pair` over ssh).
func (c *CLI) Pair(asJSON bool) error {
	if len(c.cfg.Routes()) == 0 && !asJSON {
		c.view.message("No routes configured", "Run luther funnel (Tailscale on this Mac) or luther tunnel --quick (no account) first; the phone needs a reachable URL.")
	}
	res, err := c.adminPost("/pair/code")
	if err != nil {
		return fmt.Errorf("server not running (%v); run `luther start` first", err)
	}
	defer res.Body.Close()
	var out struct {
		Code    string    `json:"code"`
		Expires time.Time `json:"expires"`
	}
	if res.StatusCode != 200 || json.NewDecoder(res.Body).Decode(&out) != nil {
		return fmt.Errorf("server refused to issue a code (HTTP %d)", res.StatusCode)
	}
	b, _ := json.Marshal(c.payload(c.cfg.Routes(), out.Code))
	if asJSON {
		fmt.Fprintln(c.out, string(b))
		return nil
	}
	c.view.message("Pair your phone", "Scan with Luther's pairing camera.")
	c.view.qr(string(b))
	fmt.Fprintf(c.out, "\nOr paste this pairing payload:\n%s\n\nCode %s, single use, valid until %s.\n", b, out.Code, out.Expires.Format("15:04"))
	return nil
}

// payload: what the phone scans. pub is this machine's key for end-to-end
// encryption (the QR never crosses the network, so the phone can trust it).
func (c *CLI) payload(routes []string, code string) map[string]any {
	return map[string]any{"v": 2, "name": c.cfg.DisplayName(), "routes": routes, "code": code, "pub": c.cfg.PublicKey()}
}

// tailscaleCmd: `tailscale serve` HTTPS on the tailnet → this server; with
// funnel, `tailscale funnel` (the same address, reachable from the internet,
// so the phone needs no Tailscale). Refuses to take a port already proxied
// elsewhere unless --force.
func (c *CLI) Tailscale(port int, force, funnel bool) error {
	if funnel && port != 443 && port != 8443 && port != 10000 {
		return fmt.Errorf("Funnel only serves ports 443, 8443 and 10000")
	}
	out, err := exec.Command("tailscale", "status", "--json").Output()
	if err != nil {
		return fmt.Errorf("tailscale not running or not installed: %v", err)
	}
	var st struct{ Self struct{ DNSName string } }
	json.Unmarshal(out, &st)
	host := strings.TrimSuffix(st.Self.DNSName, ".")
	if host == "" {
		return fmt.Errorf("no MagicDNS name; enable MagicDNS and HTTPS in the Tailscale admin console")
	}
	target := c.localURL()
	if cur, _ := exec.Command("tailscale", "serve", "status", "--json").Output(); !force {
		var sc struct {
			Web map[string]struct {
				Handlers map[string]struct{ Proxy string }
			}
		}
		json.Unmarshal(cur, &sc)
		for hp, web := range sc.Web {
			if strings.HasSuffix(hp, ":"+strconv.Itoa(port)) {
				for _, h := range web.Handlers {
					if h.Proxy != "" && h.Proxy != target {
						return fmt.Errorf("tailnet port %d already proxies to %s; pick another with --https 8443, or --force", port, h.Proxy)
					}
				}
			}
		}
	}
	verb := "serve"
	if funnel {
		verb = "funnel"
	}
	if b, err := exec.Command("tailscale", verb, "--bg", "--https="+strconv.Itoa(port), target).CombinedOutput(); err != nil {
		// Funnel off in the tailnet policy: tailscale prints the admin link to allow it.
		return fmt.Errorf("tailscale %s: %v: %s", verb, err, strings.TrimSpace(string(b)))
	}
	url := "https://" + host
	if port != 443 {
		url += ":" + strconv.Itoa(port)
	}
	if err := c.cfg.Set(func(cf *config.Config) { cf.Tailnet = url }); err != nil {
		return err
	}
	if funnel {
		c.view.message("Funnel ready: reachable from anywhere, end-to-end encrypted", url+" -> "+target)
	} else {
		c.view.message("Tailnet route ready", url+" -> "+target)
	}
	fmt.Fprintf(c.out, "  Undo: tailscale %s --https=%d off\n", verb, port)
	return nil
}

// tunnelCmd records the Cloudflare route and writes ~/.cloudflared/luther.yml
// for an existing tunnel. Creating the tunnel needs your Cloudflare login, so
// that part stays with you (printed below).
// QuickTunnel: a Cloudflare quick tunnel (no account; random address), kept
// running by luther serve; off stops it.
func (c *CLI) QuickTunnel(off bool) error {
	if off {
		if err := tunnel.QuickOff(); err != nil {
			return err
		}
		c.view.message("Quick tunnel off", "")
		return nil
	}
	u, err := tunnel.QuickOn(c.localURL())
	if err != nil {
		return err
	}
	c.view.message("Quick tunnel ready: reachable from anywhere, end-to-end encrypted", u+" -> "+c.localURL())
	fmt.Fprintln(c.out, "  The address changes if cloudflared restarts (e.g. after a reboot); a phone that")
	fmt.Fprintln(c.out, "  still reaches this Mac picks it up by itself, otherwise run luther pair again.")
	fmt.Fprintln(c.out, "  Off: luther tunnel --quick-off")
	return nil
}

func (c *CLI) Tunnel(url, id string) error {
	if !strings.HasPrefix(url, "https://") {
		fmt.Fprintln(c.out, `Set up a Cloudflare route (once):
  cloudflared tunnel login
  cloudflared tunnel create luther                 # prints the tunnel UUID
  luther tunnel --url https://luther.example.com --id <UUID>
  cloudflared tunnel --config ~/.cloudflared/luther.yml route dns <UUID> luther.example.com
  luther start                                     # luther serve keeps the tunnel running
Optional: protect it with Cloudflare Access (service token) and enter that token in the app.`)
		return nil
	}
	route := strings.TrimSuffix(url, "/")
	if err := c.cfg.Set(func(cf *config.Config) { cf.Tunnel = route }); err != nil {
		return err
	}
	c.view.message("Cloudflare route configured", route)
	if id != "" {
		host := strings.TrimPrefix(route, "https://")
		yml := fmt.Sprintf("tunnel: %s\ncredentials-file: %s\ningress:\n  - hostname: %s\n    service: %s\n  - service: http_status:404\n",
			id, filepath.Join(paths.Home, ".cloudflared", id+".json"), host, c.localURL())
		p := filepath.Join(paths.Home, ".cloudflared", "luther.yml")
		if err := os.WriteFile(p, []byte(yml), 0o600); err != nil {
			return err
		}
		fmt.Fprintln(c.out, "  Wrote", p)
	}
	return nil
}

// serviceCmd: launchd LaunchAgents (a GUI-session agent so the CLIs can reach the
// login keychain): dev.luther.server, and dev.luther.tunnel if luther.yml exists.
func (c *CLI) Service(action string) error {
	if goruntime.GOOS == "linux" {
		return c.systemd(action)
	}
	domain := "gui/" + strconv.Itoa(os.Getuid())
	agents := filepath.Join(paths.Home, "Library", "LaunchAgents")
	if action == "uninstall" {
		for _, l := range []string{"dev.luther.server", "dev.luther.tunnel"} {
			exec.Command("launchctl", "bootout", domain+"/"+l).Run()
			os.Remove(filepath.Join(agents, l+".plist"))
		}
		c.view.message("Login services removed", "Luther and its managed tunnel no longer start at login.")
		return nil
	}
	bin, err := selfPath()
	if err != nil {
		return err
	}
	if err := launchAgent("dev.luther.server", []string{bin, "serve"}, filepath.Join(config.Dir(), "serve.log")); err != nil {
		return err
	}
	c.view.message("Start at login enabled", "LaunchAgent dev.luther.server · log ~/.luther/serve.log")
	yml := filepath.Join(paths.Home, ".cloudflared", "luther.yml")
	if cf, err := exec.LookPath("cloudflared"); err == nil && paths.IsFile(yml) {
		if err := launchAgent("dev.luther.tunnel", []string{cf, "tunnel", "--config", yml, "run"}, filepath.Join(config.Dir(), "tunnel.log")); err != nil {
			return err
		}
		c.view.message("Cloudflare login service enabled", "LaunchAgent dev.luther.tunnel")
	}
	return c.waitUp()
}

func (c *CLI) waitUp() error {
	for i := 0; i < 40; i++ {
		if c.running() {
			c.view.message("Luther is ready", c.localURL()+" · luther pair to connect your phone")
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("server didn't come up; see ~/.luther/serve.log")
}

// selfPath: `luther` on PATH (a stable path survives rebuilds), else this binary.
func selfPath() (string, error) {
	bin, err := exec.LookPath("luther")
	if err != nil {
		if bin, err = os.Executable(); err != nil {
			return "", err
		}
	}
	return filepath.Abs(bin)
}

// systemd: the Linux service, a systemd user unit (luther.service). On a server
// it needs lingering to run while you're logged out.
func (c *CLI) systemd(action string) error {
	dir := filepath.Join(paths.Home, ".config", "systemd", "user")
	unit := filepath.Join(dir, "luther.service")
	sc := func(a ...string) error {
		out, err := exec.Command("systemctl", append([]string{"--user"}, a...)...).CombinedOutput()
		if err != nil {
			return fmt.Errorf("systemctl --user %s: %v: %s", strings.Join(a, " "), err, strings.TrimSpace(string(out)))
		}
		return nil
	}
	if action == "uninstall" {
		sc("disable", "--now", "luther.service")
		os.Remove(unit)
		sc("daemon-reload")
		c.view.message("Login service removed", "Removed systemd user service luther.service.")
		return nil
	}
	bin, err := selfPath()
	if err != nil {
		return err
	}
	os.MkdirAll(dir, 0o755)
	os.MkdirAll(config.Dir(), 0o700)
	log := filepath.Join(config.Dir(), "serve.log")
	body := fmt.Sprintf("[Unit]\nDescription=Luther server\nAfter=network-online.target\n\n[Service]\nExecStart=%s serve\nRestart=always\nRestartSec=10\nStandardOutput=append:%s\nStandardError=append:%s\n\n[Install]\nWantedBy=default.target\n", bin, log, log)
	if err := os.WriteFile(unit, []byte(body), 0o644); err != nil {
		return err
	}
	if err := sc("daemon-reload"); err != nil {
		return err
	}
	if err := sc("enable", "--now", "luther.service"); err != nil {
		return err
	}
	sc("restart", "luther.service")
	c.view.message("Start at login enabled", "systemd user unit luther.service · log ~/.luther/serve.log")
	if out, _ := exec.Command("loginctl", "show-user", os.Getenv("USER"), "-p", "Linger").Output(); !strings.Contains(string(out), "yes") {
		fmt.Fprintln(c.out, "  To keep it running while logged out: sudo loginctl enable-linger $USER")
	}
	return c.waitUp()
}

func launchAgent(label string, args []string, logPath string) error {
	esc := func(s string) string { var b bytes.Buffer; xml.EscapeText(&b, []byte(s)); return b.String() }
	var a strings.Builder
	for _, x := range args {
		a.WriteString("\t\t<string>" + esc(x) + "</string>\n")
	}
	plist := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>` + label + `</string>
	<key>ProgramArguments</key>
	<array>
` + a.String() + `	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>ThrottleInterval</key>
	<integer>10</integer>
	<key>StandardOutPath</key>
	<string>` + esc(logPath) + `</string>
	<key>StandardErrorPath</key>
	<string>` + esc(logPath) + `</string>
</dict>
</plist>
`
	dir := filepath.Join(paths.Home, "Library", "LaunchAgents")
	os.MkdirAll(dir, 0o755)
	os.MkdirAll(config.Dir(), 0o700)
	path := filepath.Join(dir, label+".plist")
	if err := os.WriteFile(path, []byte(plist), 0o644); err != nil {
		return err
	}
	domain := "gui/" + strconv.Itoa(os.Getuid())
	exec.Command("launchctl", "bootout", domain+"/"+label).Run() // not loaded yet is fine
	if out, err := exec.Command("launchctl", "bootstrap", domain, path).CombinedOutput(); err != nil {
		return fmt.Errorf("launchctl bootstrap %s: %v: %s", label, err, strings.TrimSpace(string(out)))
	}
	return nil
}

// doctorCmd: what's installed, whether the server and each route answer.
func (c *CLI) Doctor() {
	ok := c.view.check
	c.view.message("Luther doctor", "CHECK means attention may be needed; install only the agents you use.")
	env.LoginPath()
	for _, bin := range []string{"claude", "codex", "opencode", "gemini", "cursor-agent", "devin", "omp", "tmux", "git", "gh", "tailscale", "cloudflared"} {
		args := []string{"--version"}
		if bin == "tmux" {
			args = []string{"-V"}
		}
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		out, err := exec.CommandContext(ctx, bin, args...).CombinedOutput()
		cancel()
		v := strings.TrimSpace(strings.SplitN(ansi.Strip(string(out)), "\n", 2)[0])
		if err != nil {
			v = "unavailable: " + err.Error()
		}
		ok(err == nil, bin, v)
	}
	fmt.Fprintln(c.out)
	c.view.message("Connectivity", "")
	res, err := (&http.Client{Timeout: 3 * time.Second}).Get(c.localURL() + "/healthz")
	ok(err == nil && res.StatusCode == 200, "server", c.localURL())
	if err == nil {
		res.Body.Close()
	}
	for _, u := range c.cfg.Routes() {
		res, err := (&http.Client{Timeout: 6 * time.Second}).Get(u + "/healthz")
		detail := u
		if err != nil {
			detail += "  (" + err.Error() + ")"
		} else if res.StatusCode != 200 {
			detail += fmt.Sprintf("  (HTTP %d — Cloudflare Access blocks requests without the service token)", res.StatusCode)
		}
		ok(err == nil && res.StatusCode == 200, "route", detail)
		if err == nil {
			res.Body.Close()
		}
	}
	if len(c.cfg.Routes()) == 0 {
		ok(false, "route", "none: run `luther funnel` or `luther tunnel --quick`")
	}
	n := len(c.cfg.ListDevices())
	ok(n > 0, "devices", fmt.Sprintf("%d paired (`luther pair` adds one)", n))
}

package cli

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"flag"
	"fmt"
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
	"github.com/mdp/qrterminal/v3"
)

// Package cli: the commands on the machine running the agents — pair, tailscale, tunnel, service, doctor.
// They talk to the running server with the admin token from the config, or edit
// that config and launchd.

// CLI: the commands, over one loaded config.
type CLI struct{ cfg *config.Config }

func New(cfg *config.Config) *CLI { return &CLI{cfg: cfg} }

func (c *CLI) localURL() string { return fmt.Sprintf("http://127.0.0.1:%d", c.cfg.Port) }

func (c *CLI) adminPost(path string) (*http.Response, error) {
	req, _ := http.NewRequest("POST", c.localURL()+path, nil)
	req.Header.Set("Authorization", "Bearer "+c.cfg.AdminToken)
	return (&http.Client{Timeout: 5 * time.Second}).Do(req)
}

// Pair prints a QR the phone scans once: name, routes, one-time code. With
// --json it prints only the payload (for `luther remote pair` over ssh).
func (c *CLI) Pair(args []string) error {
	asJSON := len(args) > 0 && args[0] == "--json"
	if len(c.cfg.Routes()) == 0 && !asJSON {
		fmt.Println("! No routes yet. Run `luther tailscale` and/or `luther tunnel` first; the phone needs a URL to reach this Mac.")
	}
	res, err := c.adminPost("/pair/code")
	if err != nil {
		return fmt.Errorf("server not running (%v); start it with `luther service install` or `luther serve`", err)
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
		fmt.Println(string(b))
		return nil
	}
	qrterminal.GenerateHalfBlock(string(b), qrterminal.L, os.Stdout)
	fmt.Printf("\nScan with the Luther app (or paste):\n%s\n\nCode %s, single use, valid until %s.\n", b, out.Code, out.Expires.Format("15:04"))
	return nil
}

// payload: what the phone scans. pub is this machine's key for end-to-end
// encryption (the QR never crosses the network, so the phone can trust it).
func (c *CLI) payload(routes []string, code string) map[string]any {
	return map[string]any{"v": 2, "name": c.cfg.DisplayName(), "routes": routes, "code": code, "pub": c.cfg.PublicKey()}
}

// tailscaleCmd: `tailscale serve` HTTPS on the tailnet → this server. Refuses to
// take a port already proxied elsewhere unless --force.
func (c *CLI) Tailscale(args []string) error {
	fs := flag.NewFlagSet("tailscale", flag.ExitOnError)
	port := fs.Int("https", 443, "HTTPS port on the tailnet")
	force := fs.Bool("force", false, "replace an existing mapping on that port")
	fs.Parse(args)
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
	if cur, _ := exec.Command("tailscale", "serve", "status", "--json").Output(); !*force {
		var sc struct {
			Web map[string]struct {
				Handlers map[string]struct{ Proxy string }
			}
		}
		json.Unmarshal(cur, &sc)
		for hp, web := range sc.Web {
			if strings.HasSuffix(hp, ":"+strconv.Itoa(*port)) {
				for _, h := range web.Handlers {
					if h.Proxy != "" && h.Proxy != target {
						return fmt.Errorf("tailnet port %d already proxies to %s; pick another with --https 8443, or --force", *port, h.Proxy)
					}
				}
			}
		}
	}
	if b, err := exec.Command("tailscale", "serve", "--bg", "--https="+strconv.Itoa(*port), target).CombinedOutput(); err != nil {
		return fmt.Errorf("tailscale serve: %v: %s", err, strings.TrimSpace(string(b)))
	}
	url := "https://" + host
	if *port != 443 {
		url += ":" + strconv.Itoa(*port)
	}
	if err := c.cfg.Set(func(cf *config.Config) { cf.Tailnet = url }); err != nil {
		return err
	}
	fmt.Printf("✓ tailnet route: %s → %s\n  undo: tailscale serve --https=%d off\n", url, target, *port)
	return nil
}

// tunnelCmd records the Cloudflare route and writes ~/.cloudflared/luther.yml
// for an existing tunnel. Creating the tunnel needs your Cloudflare login, so
// that part stays with you (printed below).
func (c *CLI) Tunnel(args []string) error {
	fs := flag.NewFlagSet("tunnel", flag.ExitOnError)
	url := fs.String("url", "", "public URL, e.g. https://luther.example.com")
	id := fs.String("id", "", "tunnel UUID from `cloudflared tunnel create luther`")
	fs.Parse(args)
	if !strings.HasPrefix(*url, "https://") {
		fmt.Println(`Set up a Cloudflare tunnel (once):
  cloudflared tunnel login
  cloudflared tunnel create luther                 # prints the tunnel UUID
  luther tunnel --url https://luther.example.com --id <UUID>
  cloudflared tunnel --config ~/.cloudflared/luther.yml route dns --overwrite-dns <UUID> luther.example.com
  luther service install                           # runs the tunnel at login too
Optional: protect it with Cloudflare Access (service token) and enter that token in the app.`)
		return nil
	}
	tunnel := strings.TrimSuffix(*url, "/")
	if err := c.cfg.Set(func(cf *config.Config) { cf.Tunnel = tunnel }); err != nil {
		return err
	}
	fmt.Println("✓ tunnel route:", tunnel)
	if *id != "" {
		host := strings.TrimPrefix(tunnel, "https://")
		yml := fmt.Sprintf("tunnel: %s\ncredentials-file: %s\ningress:\n  - hostname: %s\n    service: %s\n  - service: http_status:404\n",
			*id, filepath.Join(paths.Home, ".cloudflared", *id+".json"), host, c.localURL())
		p := filepath.Join(paths.Home, ".cloudflared", "luther.yml")
		if err := os.WriteFile(p, []byte(yml), 0o600); err != nil {
			return err
		}
		fmt.Println("✓ wrote", p)
	}
	return nil
}

// serviceCmd: launchd LaunchAgents (a GUI-session agent so the CLIs can reach the
// login keychain): dev.luther.server, and dev.luther.tunnel if luther.yml exists.
func (c *CLI) Service(args []string) error {
	if len(args) == 0 || (args[0] != "install" && args[0] != "uninstall") {
		return fmt.Errorf("usage: luther service install|uninstall")
	}
	if goruntime.GOOS == "linux" {
		return c.systemd(args[0])
	}
	domain := "gui/" + strconv.Itoa(os.Getuid())
	agents := filepath.Join(paths.Home, "Library", "LaunchAgents")
	if args[0] == "uninstall" {
		for _, l := range []string{"dev.luther.server", "dev.luther.tunnel"} {
			exec.Command("launchctl", "bootout", domain+"/"+l).Run()
			os.Remove(filepath.Join(agents, l+".plist"))
		}
		fmt.Println("✓ removed LaunchAgents dev.luther.server and dev.luther.tunnel")
		return nil
	}
	bin, err := selfPath()
	if err != nil {
		return err
	}
	if err := launchAgent("dev.luther.server", []string{bin, "serve"}, filepath.Join(config.Dir(), "serve.log")); err != nil {
		return err
	}
	fmt.Println("✓ server: LaunchAgent dev.luther.server (starts at login, restarts if it dies); log ~/.luther/serve.log")
	yml := filepath.Join(paths.Home, ".cloudflared", "luther.yml")
	if cf, err := exec.LookPath("cloudflared"); err == nil && paths.IsFile(yml) {
		if err := launchAgent("dev.luther.tunnel", []string{cf, "tunnel", "--config", yml, "run"}, filepath.Join(config.Dir(), "tunnel.log")); err != nil {
			return err
		}
		fmt.Println("✓ tunnel: LaunchAgent dev.luther.tunnel")
	}
	return c.waitUp()
}

func (c *CLI) waitUp() error {
	for i := 0; i < 40; i++ {
		if res, err := http.Get(c.localURL() + "/healthz"); err == nil && res.StatusCode == 200 {
			fmt.Println("✓ server answering on", c.localURL())
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
		fmt.Println("✓ removed luther.service")
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
	fmt.Println("✓ server: systemd user unit luther.service; log ~/.luther/serve.log")
	if out, _ := exec.Command("loginctl", "show-user", os.Getenv("USER"), "-p", "Linger").Output(); !strings.Contains(string(out), "yes") {
		fmt.Println("! to keep it running while you're logged out: sudo loginctl enable-linger $USER")
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
	ok := func(good bool, what, detail string) {
		mark := "✓"
		if !good {
			mark = "✗"
		}
		fmt.Printf("%s %-12s %s\n", mark, what, detail)
	}
	env.LoginPath()
	for _, bin := range []string{"claude", "codex", "tmux", "git", "gh", "tailscale", "cloudflared"} {
		out, err := exec.Command(bin, "--version").CombinedOutput()
		if bin == "tmux" {
			out, err = exec.Command(bin, "-V").CombinedOutput()
		}
		v := strings.TrimSpace(strings.SplitN(string(out), "\n", 2)[0])
		if err != nil {
			v = "not found"
		}
		ok(err == nil, bin, v)
	}
	res, err := (&http.Client{Timeout: 3 * time.Second}).Get(c.localURL() + "/healthz")
	ok(err == nil && res.StatusCode == 200, "server", c.localURL())
	for _, u := range c.cfg.Routes() {
		res, err := (&http.Client{Timeout: 6 * time.Second}).Get(u + "/healthz")
		detail := u
		if err != nil {
			detail += "  (" + err.Error() + ")"
		} else if res.StatusCode != 200 {
			detail += fmt.Sprintf("  (HTTP %d — Cloudflare Access blocks requests without the service token)", res.StatusCode)
		}
		ok(err == nil && res.StatusCode == 200, "route", detail)
	}
	if len(c.cfg.Routes()) == 0 {
		ok(false, "route", "none: run `luther tailscale` or `luther tunnel`")
	}
	n := len(c.cfg.ListDevices())
	ok(n > 0, "devices", fmt.Sprintf("%d paired (`luther pair` adds one)", n))
}

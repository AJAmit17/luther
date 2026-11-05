package main

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
	"strconv"
	"strings"
	"time"

	"github.com/mdp/qrterminal/v3"
)

// Mac-side commands. They talk to the running server with the admin token from
// ~/.luther/config.json, or edit that config and launchd.

func localURL() string { return fmt.Sprintf("http://127.0.0.1:%d", cfg.Port) }

func adminPost(path string) (*http.Response, error) {
	req, _ := http.NewRequest("POST", localURL()+path, nil)
	req.Header.Set("Authorization", "Bearer "+cfg.AdminToken)
	return (&http.Client{Timeout: 5 * time.Second}).Do(req)
}

// pairCmd prints a QR the phone scans once: name, routes, one-time code.
func pairCmd() error {
	if len(cfg.routes()) == 0 {
		fmt.Println("! No routes yet. Run `luther tailscale` and/or `luther tunnel` first; the phone needs a URL to reach this Mac.")
	}
	res, err := adminPost("/pair/code")
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
	b, _ := json.Marshal(map[string]any{"v": 1, "name": cfg.Name, "routes": cfg.routes(), "code": out.Code})
	qrterminal.GenerateHalfBlock(string(b), qrterminal.L, os.Stdout)
	fmt.Printf("\nScan with the Luther app (or paste):\n%s\n\nCode %s, single use, valid until %s.\n", b, out.Code, out.Expires.Format("15:04"))
	return nil
}

// tailscaleCmd: `tailscale serve` HTTPS on the tailnet → this server. Refuses to
// take a port already proxied elsewhere unless --force.
func tailscaleCmd(args []string) error {
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
	target := localURL()
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
	cfg.Tailnet = url
	if err := cfg.save(); err != nil {
		return err
	}
	fmt.Printf("✓ tailnet route: %s → %s\n  undo: tailscale serve --https=%d off\n", url, target, *port)
	return nil
}

// tunnelCmd records the Cloudflare route and writes ~/.cloudflared/luther.yml
// for an existing tunnel. Creating the tunnel needs your Cloudflare login, so
// that part stays with you (printed below).
func tunnelCmd(args []string) error {
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
	cfg.Tunnel = strings.TrimSuffix(*url, "/")
	if err := cfg.save(); err != nil {
		return err
	}
	fmt.Println("✓ tunnel route:", cfg.Tunnel)
	if *id != "" {
		host := strings.TrimPrefix(cfg.Tunnel, "https://")
		yml := fmt.Sprintf("tunnel: %s\ncredentials-file: %s\ningress:\n  - hostname: %s\n    service: %s\n  - service: http_status:404\n",
			*id, filepath.Join(home, ".cloudflared", *id+".json"), host, localURL())
		p := filepath.Join(home, ".cloudflared", "luther.yml")
		if err := os.WriteFile(p, []byte(yml), 0o600); err != nil {
			return err
		}
		fmt.Println("✓ wrote", p)
	}
	return nil
}

// serviceCmd: launchd LaunchAgents (a GUI-session agent so the CLIs can reach the
// login keychain): dev.luther.server, and dev.luther.tunnel if luther.yml exists.
func serviceCmd(args []string) error {
	if len(args) == 0 || (args[0] != "install" && args[0] != "uninstall") {
		return fmt.Errorf("usage: luther service install|uninstall")
	}
	domain := "gui/" + strconv.Itoa(os.Getuid())
	agents := filepath.Join(home, "Library", "LaunchAgents")
	if args[0] == "uninstall" {
		for _, l := range []string{"dev.luther.server", "dev.luther.tunnel"} {
			exec.Command("launchctl", "bootout", domain+"/"+l).Run()
			os.Remove(filepath.Join(agents, l+".plist"))
		}
		fmt.Println("✓ removed LaunchAgents dev.luther.server and dev.luther.tunnel")
		return nil
	}
	bin, err := exec.LookPath("luther") // a stable path survives rebuilds
	if err != nil {
		if bin, err = os.Executable(); err != nil {
			return err
		}
	}
	bin, _ = filepath.Abs(bin)
	if err := launchAgent("dev.luther.server", []string{bin, "serve"}, filepath.Join(lutherDir(), "serve.log")); err != nil {
		return err
	}
	fmt.Println("✓ server: LaunchAgent dev.luther.server (starts at login, restarts if it dies); log ~/.luther/serve.log")
	yml := filepath.Join(home, ".cloudflared", "luther.yml")
	if cf, err := exec.LookPath("cloudflared"); err == nil && isFile(yml) {
		if err := launchAgent("dev.luther.tunnel", []string{cf, "tunnel", "--config", yml, "run"}, filepath.Join(lutherDir(), "tunnel.log")); err != nil {
			return err
		}
		fmt.Println("✓ tunnel: LaunchAgent dev.luther.tunnel")
	}
	for i := 0; i < 40; i++ {
		if res, err := http.Get(localURL() + "/healthz"); err == nil && res.StatusCode == 200 {
			fmt.Println("✓ server answering on", localURL())
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("server didn't come up; see ~/.luther/serve.log")
}

func isFile(p string) bool { fi, err := os.Stat(p); return err == nil && !fi.IsDir() }

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
	dir := filepath.Join(home, "Library", "LaunchAgents")
	os.MkdirAll(dir, 0o755)
	os.MkdirAll(lutherDir(), 0o700)
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
func doctorCmd() {
	ok := func(good bool, what, detail string) {
		mark := "✓"
		if !good {
			mark = "✗"
		}
		fmt.Printf("%s %-12s %s\n", mark, what, detail)
	}
	loginPath()
	for _, bin := range []string{"claude", "codex", "tmux", "git", "tailscale", "cloudflared"} {
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
	res, err := (&http.Client{Timeout: 3 * time.Second}).Get(localURL() + "/healthz")
	ok(err == nil && res.StatusCode == 200, "server", localURL())
	for _, u := range cfg.routes() {
		res, err := (&http.Client{Timeout: 6 * time.Second}).Get(u + "/healthz")
		detail := u
		if err != nil {
			detail += "  (" + err.Error() + ")"
		} else if res.StatusCode != 200 {
			detail += fmt.Sprintf("  (HTTP %d — Cloudflare Access blocks requests without the service token)", res.StatusCode)
		}
		ok(err == nil && res.StatusCode == 200, "route", detail)
	}
	if len(cfg.routes()) == 0 {
		ok(false, "route", "none: run `luther tailscale` or `luther tunnel`")
	}
	cfgMu.Lock()
	n := len(cfg.Devices)
	cfgMu.Unlock()
	ok(n > 0, "devices", fmt.Sprintf("%d paired (`luther pair` adds one)", n))
}

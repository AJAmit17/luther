package cli

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/AJAmit17/luther/server/internal/lifecycle"
	"github.com/AJAmit17/luther/server/internal/tunnel"
)

type serverHealth struct {
	OK      bool   `json:"ok"`
	Name    string `json:"name"`
	Version string `json:"version"`
}

func (c *CLI) health() (serverHealth, error) {
	var health serverHealth
	res, err := (&http.Client{Timeout: time.Second}).Get(c.localURL() + "/healthz")
	if err != nil {
		return health, err
	}
	defer res.Body.Close()
	if err := json.NewDecoder(res.Body).Decode(&health); err != nil {
		return health, err
	}
	if res.StatusCode != http.StatusOK || !health.OK || health.Version == "" {
		return health, fmt.Errorf("server did not report a healthy Luther build (HTTP %d)", res.StatusCode)
	}
	return health, nil
}

func (c *CLI) running() bool {
	_, err := c.health()
	return err == nil
}

func (c *CLI) Start() error {
	if c.running() {
		c.view.message("Luther is already running", c.localURL()+" · luther status for details")
		return nil
	}
	bin, err := os.Executable()
	if err != nil {
		return err
	}
	if err := lifecycle.Start(bin); err != nil {
		return err
	}
	if err := c.waitUp(); err != nil {
		return err
	}
	c.reopen()
	return nil
}

// tailnetPort: the HTTPS port of the tailnet route, 0 if there's none.
func (c *CLI) tailnetPort() int {
	if c.cfg.Tailnet == "" {
		return 0
	}
	if _, p, ok := strings.Cut(strings.TrimPrefix(c.cfg.Tailnet, "https://"), ":"); ok {
		n, _ := strconv.Atoi(p)
		return n
	}
	return 443
}

// reopen: after a start, the tailnet route again (Funnel or Serve, as it was);
// luther serve starts the Cloudflare tunnels by itself.
func (c *CLI) reopen() {
	if port := c.tailnetPort(); port != 0 {
		if err := c.Tailscale(port, true, c.cfg.Funnel); err != nil {
			fmt.Fprintln(c.out, "  tailnet route not reopened:", err)
		}
	}
}

// closeRoutes: on stop, every way in is closed: the tailnet route is taken
// off its port (Luther's port only) and both cloudflared processes end. The
// named tunnel and its DNS record stay; luther start opens them all again.
func (c *CLI) closeRoutes() {
	if port := c.tailnetPort(); port != 0 {
		exec.Command("tailscale", "serve", "--https="+strconv.Itoa(port), "off").Run()
	}
	tunnel.CloseQuick()
	tunnel.CloseNamed()
}

func (c *CLI) Stop() error {
	if !lifecycle.Loaded() && c.running() {
		return fmt.Errorf("the server is running in the foreground, not as a managed service; stop that luther serve process with Ctrl-C")
	}
	if err := lifecycle.Stop(); err != nil {
		return err
	}
	for range 40 {
		if !c.running() {
			c.closeRoutes()
			c.view.message("Luther stopped", "Tailnet route and Cloudflare tunnels closed; idle sleep is allowed again. Run luther start when you're ready.")
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("the server is still answering; see ~/.luther/serve.log")
}

func (c *CLI) Status(asJSON bool) error {
	health, err := c.health()
	status := struct {
		Name    string   `json:"name"`
		Running bool     `json:"running"`
		Version string   `json:"version,omitempty"`
		URL     string   `json:"url"`
		Routes  []string `json:"routes"`
		Devices int      `json:"devices"`
	}{
		Name: c.cfg.DisplayName(), Running: err == nil, URL: c.localURL(),
		Routes: append([]string{}, c.cfg.Routes()...), Devices: len(c.cfg.ListDevices()),
	}
	if status.Running {
		status.Version = health.Version
		if health.Name != "" {
			status.Name = health.Name
		}
	}
	if asJSON {
		return json.NewEncoder(c.out).Encode(status)
	}
	state, wake := "Stopped · luther start", "Inactive (server stopped)"
	if status.Running {
		state = c.view.label("Running", "#45A77B") + " · " + health.Version
		wake = "Managed by the server on macOS"
		if runtime.GOOS != "darwin" {
			wake = "Not configured on this platform"
		}
	}
	tailnet, named := c.cfg.Tailnet, c.cfg.Tunnel
	if tailnet == "" {
		tailnet = "Not configured · luther funnel or luther tailscale"
	}
	if named == "" {
		named = "Not configured · luther tunnel"
	}
	q := tunnel.QuickURL()
	if q == "" {
		q = "Off · luther tunnel --quick"
	}
	c.view.panel("LUTHER / status", [][2]string{
		{"Machine", status.Name}, {"Server", state}, {"Local", status.URL},
		{"Sleep guard", wake}, {"Phones", strconv.Itoa(status.Devices) + " paired"},
		{"Tailnet", tailnet}, {"Cloudflare", named}, {"Quick tunnel", q}, {"Logs", "~/.luther/serve.log"},
	})
	return nil
}

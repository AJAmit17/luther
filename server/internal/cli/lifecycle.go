package cli

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"time"

	"github.com/AJAmit17/luther/server/internal/lifecycle"
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
	return c.waitUp()
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
			c.view.message("Luther stopped", "Idle sleep is allowed again. Run luther start when you're ready.")
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
	tailnet, tunnel := c.cfg.Tailnet, c.cfg.Tunnel
	if tailnet == "" {
		tailnet = "Not configured · luther tailscale"
	}
	if tunnel == "" {
		tunnel = "Not configured · luther tunnel"
	}
	c.view.panel("LUTHER / status", [][2]string{
		{"Machine", status.Name}, {"Server", state}, {"Local", status.URL},
		{"Sleep guard", wake}, {"Phones", strconv.Itoa(status.Devices) + " paired"},
		{"Tailnet", tailnet}, {"Cloudflare", tunnel}, {"Logs", "~/.luther/serve.log"},
	})
	return nil
}

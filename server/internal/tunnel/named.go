package tunnel

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"github.com/AJAmit17/luther/server/internal/paths"
)

// A named Cloudflare tunnel on your own domain (`luther tunnel --url … --id …`
// writes its config, ~/.cloudflared/luther.yml). luther serve keeps it running
// the same way as a quick one: detached, started again if it ends. If
// something else already runs it (the login service), that one is left alone.

func NamedConfig() string { return filepath.Join(paths.Home, ".cloudflared", "luther.yml") }

// KeepNamed: every minute, while on() says the tunnel is configured and its
// config exists, make sure a cloudflared runs it.
func KeepNamed(on func() bool) {
	for {
		if _, err := os.Stat(NamedConfig()); err == nil && on() && !namedRunning() {
			if err := startNamed(); err != nil {
				fmt.Fprintln(os.Stderr, "cloudflare tunnel:", err)
			}
		}
		time.Sleep(time.Minute)
	}
}

// namedRunning: some cloudflared runs luther.yml (ours or the login service's).
func namedRunning() bool {
	return exec.Command("pgrep", "-f", "cloudflared.*"+NamedConfig()).Run() == nil
}

func startNamed() error {
	bin, err := exec.LookPath("cloudflared")
	if err != nil {
		return err
	}
	logf, err := os.OpenFile(filepath.Join(dir(), "tunnel.log"), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer logf.Close()
	cmd := exec.Command(bin, "tunnel", "--config", NamedConfig(), "--no-autoupdate", "run")
	cmd.Stdout, cmd.Stderr = logf, logf
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // survives luther's restarts
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

// CloseNamed stops the cloudflared running luther.yml (the tunnel itself and
// its DNS record stay; luther serve starts it again).
func CloseNamed() {
	exec.Command("pkill", "-f", "cloudflared.*"+NamedConfig()).Run()
}

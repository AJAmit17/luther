// Package tunnel: Cloudflare tunnels luther serve keeps running. A quick
// tunnel (this file), for reaching this Mac from a phone
// with nothing installed on it and no Cloudflare account: `cloudflared tunnel
// --url` answers with a random https://….trycloudflare.com address.
//
// cloudflared runs detached (its own process group), so it outlives restarts
// of luther and the address stays the same until cloudflared itself restarts
// (a reboot, a crash). The state is in ~/.luther/quick.json, apart from
// config.json, since both the CLI and the server touch it. A changed address
// reaches the phone the next time it connects by any route (GET /routes);
// otherwise `luther pair` shows the new one.
package tunnel

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/AJAmit17/luther/server/internal/paths"
)

type QuickTunnel struct {
	On  bool   `json:"on"`
	URL string `json:"url,omitempty"`
	PID int    `json:"pid,omitempty"`
}

func dir() string     { return filepath.Join(paths.Home, ".luther") }
func file() string    { return filepath.Join(dir(), "quick.json") }
func logFile() string { return filepath.Join(dir(), "quick.log") }

func QuickState() QuickTunnel {
	var s QuickTunnel
	if b, err := os.ReadFile(file()); err == nil {
		json.Unmarshal(b, &s)
	}
	return s
}

func save(s QuickTunnel) error {
	b, _ := json.Marshal(s)
	if err := os.MkdirAll(dir(), 0o700); err != nil {
		return err
	}
	return os.WriteFile(file(), b, 0o600)
}

// QuickURL: the tunnel's address while it runs, else "".
func QuickURL() string {
	if s := QuickState(); s.On && alive(s.PID) {
		return s.URL
	}
	return ""
}

// QuickOn turns the tunnel on (starting cloudflared if it isn't running) and
// returns its address.
func QuickOn(target string) (string, error) {
	if s := QuickState(); s.On && alive(s.PID) && s.URL != "" {
		return s.URL, nil
	}
	return start(target)
}

// QuickOff stops cloudflared and turns the tunnel off.
func QuickOff() error {
	s := QuickState()
	if alive(s.PID) {
		syscall.Kill(s.PID, syscall.SIGTERM)
	}
	return save(QuickTunnel{})
}

// CloseQuick stops the quick tunnel's cloudflared but leaves it on, so
// luther serve starts it again (with a new address).
func CloseQuick() {
	if s := QuickState(); alive(s.PID) {
		syscall.Kill(s.PID, syscall.SIGTERM)
	}
}

// KeepQuick, in `luther serve`: every minute, a tunnel that's on but not running is
// started again (its address then changes).
func KeepQuick(target string) {
	for {
		if s := QuickState(); s.On && !alive(s.PID) {
			if _, err := start(target); err != nil {
				fmt.Fprintln(os.Stderr, "quick tunnel:", err)
			}
		}
		time.Sleep(time.Minute)
	}
}

var addr = regexp.MustCompile(`https://[a-z0-9-]+\.trycloudflare\.com`)

func start(target string) (string, error) {
	bin, err := exec.LookPath("cloudflared")
	if err != nil {
		return "", errors.New("cloudflared isn't installed: brew install cloudflared")
	}
	os.MkdirAll(dir(), 0o700)
	logf, err := os.OpenFile(logFile(), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	defer logf.Close()
	// An empty config of its own: cloudflared otherwise reads
	// ~/.cloudflared/config.yml, whose ingress rules (another tunnel's) would
	// answer this one's requests with their catch-all 404.
	empty := filepath.Join(dir(), "quick.yml")
	if err := os.WriteFile(empty, []byte("no-autoupdate: true\n"), 0o600); err != nil { // not empty: cloudflared logs an error for that
		return "", err
	}
	cmd := exec.Command(bin, "tunnel", "--config", empty, "--no-autoupdate", "--url", target)
	cmd.Stdout, cmd.Stderr = logf, logf
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // survives luther's restarts
	if err := cmd.Start(); err != nil {
		return "", err
	}
	go cmd.Wait() // reaped if it ends while this process lives
	for deadline := time.Now().Add(45 * time.Second); time.Now().Before(deadline); time.Sleep(500 * time.Millisecond) {
		if u := found(); u != "" {
			return u, save(QuickTunnel{On: true, URL: u, PID: cmd.Process.Pid})
		}
		if !alive(cmd.Process.Pid) {
			break
		}
	}
	cmd.Process.Kill()
	return "", fmt.Errorf("cloudflared gave no address; see %s", logFile())
}

// found: the address cloudflared printed to its log, or "".
func found() string {
	f, err := os.Open(logFile())
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if u := addr.FindString(sc.Text()); u != "" {
			return u
		}
	}
	return ""
}

// alive: pid is a running cloudflared.
func alive(pid int) bool {
	if pid <= 0 || syscall.Kill(pid, 0) != nil {
		return false
	}
	out, err := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "comm=").Output()
	return err == nil && strings.Contains(string(out), "cloudflared")
}

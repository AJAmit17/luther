package lifecycle

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/paths"
)

const label = "dev.luther.server"

var run = func(bin string, args ...string) ([]byte, error) {
	return exec.Command(bin, args...).CombinedOutput()
}

func domain() string { return "gui/" + strconv.Itoa(os.Getuid()) }

func command(bin string, args ...string) error {
	out, err := run(bin, args...)
	if err != nil {
		return fmt.Errorf("%s %s: %w: %s", bin, strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

func Loaded() bool {
	if runtime.GOOS == "darwin" {
		_, err := run("launchctl", "print", domain()+"/"+label)
		return err == nil
	}
	_, err := run("systemctl", "--user", "is-active", "--quiet", "luther.service")
	return err == nil
}

func Start(bin string) error {
	if Loaded() {
		return nil
	}
	switch runtime.GOOS {
	case "darwin":
		installed := filepath.Join(paths.Home, "Library", "LaunchAgents", label+".plist")
		if _, err := os.Stat(installed); err == nil {
			return command("launchctl", "bootstrap", domain(), installed)
		}
		dir := filepath.Join(config.Dir(), "launchagents")
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
		path := filepath.Join(dir, label+".plist")
		if err := os.WriteFile(path, []byte(plist(bin, filepath.Join(config.Dir(), "serve.log"))), 0o600); err != nil {
			return err
		}
		return command("launchctl", "bootstrap", domain(), path)
	case "linux":
		if paths.IsFile(filepath.Join(paths.Home, ".config", "systemd", "user", "luther.service")) {
			return command("systemctl", "--user", "start", "luther.service")
		}
		log := filepath.Join(config.Dir(), "serve.log")
		return command("systemd-run", "--user", "--unit=luther", "--collect", "--property=Restart=on-failure",
			"--property=StandardOutput=append:"+log, "--property=StandardError=append:"+log, "--", bin, "serve")
	default:
		return fmt.Errorf("background services are supported on macOS and Linux; use luther serve")
	}
}

func Stop() error {
	if !Loaded() {
		return nil
	}
	if runtime.GOOS == "darwin" {
		return command("launchctl", "bootout", domain()+"/"+label)
	}
	return command("systemctl", "--user", "stop", "luther.service")
}

func plist(bin, log string) string {
	escape := func(s string) string { var b bytes.Buffer; xml.EscapeText(&b, []byte(s)); return b.String() }
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>` + label + `</string>
<key>ProgramArguments</key><array><string>` + escape(bin) + `</string><string>serve</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>` + escape(log) + `</string>
<key>StandardErrorPath</key><string>` + escape(log) + `</string>
</dict></plist>
`
}

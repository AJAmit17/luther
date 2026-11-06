package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	goruntime "runtime"
	"strings"

	"github.com/AJAmit17/luther/server/internal/remote"
)

const remoteUsage = `usage:
  luther remote add NAME user@host [--port 47900] [--ssh "-p 2222"]
  luther remote pair NAME        QR for the phone: pairs with that machine through this one
  luther remote list
  luther remote remove NAME`

// onRemote: run luther there, finding it where installs put it (non-login ssh
// shells often lack ~/.local/bin).
func onRemote(r remote.Remote, args ...string) *exec.Cmd {
	return remote.SSH(r, `PATH="$HOME/.local/bin:$HOME/go/bin:/usr/local/bin:/opt/homebrew/bin:$PATH" luther `+strings.Join(args, " "))
}

// Remote: luther remote add|pair|list|remove.
func (c *CLI) Remote(args []string, port int, sshArg string) error {
	if len(args) == 0 {
		return fmt.Errorf("%s", remoteUsage)
	}
	rs, err := remote.Load()
	if err != nil {
		return err
	}
	find := func(name string) (remote.Remote, int) {
		for i, r := range rs {
			if r.Name == name {
				return r, i
			}
		}
		return remote.Remote{}, -1
	}
	switch args[0] {
	case "list":
		if len(rs) == 0 {
			c.view.message("No remote machines", "Add one: luther remote add NAME user@host")
		}
		for _, r := range rs {
			fmt.Fprintf(c.out, "%-16s %-28s forwarded to 127.0.0.1:%d\n", r.Name, r.Target, r.Local)
		}
		return nil

	case "remove":
		if len(args) < 2 {
			return fmt.Errorf("%s", remoteUsage)
		}
		_, i := find(args[1])
		if i < 0 {
			return fmt.Errorf("no remote %q", args[1])
		}
		if err := remote.Save(append(rs[:i], rs[i+1:]...)); err != nil {
			return err
		}
		c.reloadRemotes()
		c.view.message("Remote relay removed", args[1]+" · Luther keeps running on that machine")
		return nil

	case "pair":
		if len(args) < 2 {
			return fmt.Errorf("%s", remoteUsage)
		}
		r, i := find(args[1])
		if i < 0 {
			return fmt.Errorf("no remote %q; add it first", args[1])
		}
		if len(c.cfg.Routes()) == 0 {
			return fmt.Errorf("this machine has no routes yet; run `luther tailscale` or `luther tunnel` first")
		}
		out, err := onRemote(r, "pair", "--json").Output()
		if err != nil {
			return fmt.Errorf("luther pair on %s: %v (is its server running? `luther remote add` starts it)", r.Name, err)
		}
		var p map[string]any
		if json.Unmarshal(out, &p) != nil || p["code"] == nil {
			return fmt.Errorf("unexpected answer from %s: %s", r.Name, out)
		}
		var routes []string
		for _, u := range c.cfg.Routes() {
			routes = append(routes, u+"/r/"+r.Name)
		}
		p["routes"] = routes
		b, _ := json.Marshal(p)
		c.view.message("Pair a remote phone", r.Name+" · relayed through this machine")
		c.view.qr(string(b))
		fmt.Fprintf(c.out, "\nScan with the Luther app to pair with %s (through this machine), or paste:\n%s\n", r.Name, b)
		return nil

	case "add":
		if len(args) < 3 {
			return fmt.Errorf("%s", remoteUsage)
		}
		name, target := args[1], args[2]
		if !remote.NameRe.MatchString(name) {
			return fmt.Errorf("name: lowercase letters, digits and dashes")
		}
		if _, i := find(name); i >= 0 {
			return fmt.Errorf("%s exists; remove it first", name)
		}
		r := remote.Remote{Name: name, Target: target, Port: port, SSHArg: sshArg}
		fmt.Fprintf(c.out, "  Connecting to %s ... ", target)
		uname, err := remote.SSH(r, "uname -sm").Output()
		if err != nil {
			return fmt.Errorf("can't ssh to %s without a prompt (%v); set up key login (ssh-copy-id) and try again", target, err)
		}
		fmt.Fprintln(c.out, strings.TrimSpace(string(uname)))
		if _, err := onRemote(r, "version").Output(); err != nil {
			if !sameMachineKind(string(uname)) {
				return fmt.Errorf("luther isn't installed on %s. Install it there, then run this again:\n  ssh %s 'curl -fsSL https://raw.githubusercontent.com/AJAmit17/luther/main/install.sh | sh'", name, target)
			}
			self, err := os.Executable()
			if err != nil {
				return err
			}
			fmt.Fprintln(c.out, "  Copying Luther to ~/.local/bin/luther there (same OS and CPU)")
			if out, err := remote.SSH(r, "mkdir -p ~/.local/bin").CombinedOutput(); err != nil {
				return fmt.Errorf("%v: %s", err, out)
			}
			scp := []string{"-o", "BatchMode=yes"}
			if f := strings.Fields(sshArg); len(f) == 2 && f[0] == "-p" {
				scp = append(scp, "-P", f[1])
			}
			if out, err := exec.Command("scp", append(scp, self, target+":.local/bin/luther")...).CombinedOutput(); err != nil {
				return fmt.Errorf("scp: %v: %s", err, out)
			}
		}
		fmt.Fprintln(c.out, "  Starting Luther there (luther service install)")
		out, err := onRemote(r, "service", "install").CombinedOutput()
		fmt.Fprint(c.out, indent(string(out)))
		if err != nil {
			return fmt.Errorf("luther service install on %s: %v", name, err)
		}
		r.Local = remote.FreePort(rs)
		if err := remote.Save(append(rs, r)); err != nil {
			return err
		}
		c.reloadRemotes()
		c.view.message("Remote machine connected", name+" · relayed at <this machine's routes>/r/"+name)
		fmt.Fprintf(c.out, "  Next: luther remote pair %s\n", name)
		return nil
	}
	return fmt.Errorf("%s", remoteUsage)
}

// reloadRemotes: tell the running server (if any) to pick up the change.
func (c *CLI) reloadRemotes() {
	res, err := c.adminPost("/remotes/reload")
	if err == nil {
		defer res.Body.Close()
	}
	if err != nil || res.StatusCode != 200 {
		fmt.Fprintln(c.out, "  The server isn't running; the change applies when it starts.")
	}
}

func sameMachineKind(uname string) bool {
	f := strings.Fields(strings.ToLower(uname))
	if len(f) < 2 {
		return false
	}
	arch := map[string]string{"x86_64": "amd64", "amd64": "amd64", "arm64": "arm64", "aarch64": "arm64"}[f[1]]
	return f[0] == goruntime.GOOS && arch == goruntime.GOARCH
}

func indent(s string) string {
	if s == "" {
		return ""
	}
	return "    " + strings.ReplaceAll(strings.TrimRight(s, "\n"), "\n", "\n    ") + "\n"
}

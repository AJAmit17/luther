// Luther: the Mac-side server. Runs the coding agents (Claude Code, Codex) on
// this machine and serves them to paired phones. See docs/PLAN.md; each feature
// is a package under internal/, wired together in internal/api.
package main

import (
	"fmt"
	"os"

	"github.com/AJAmit17/luther/server/internal/api"
	"github.com/AJAmit17/luther/server/internal/cli"
	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

const usage = `usage:
  luther serve                           run the server (launchd runs this)
  luther pair                            QR + one-time code for the phone app
  luther tailscale [--https 443]         publish on your tailnet (tailscale serve)
  luther tunnel [--url URL --id UUID]    Cloudflare tunnel route (run without flags for steps)
  luther service install|uninstall       run at login (launchd)
  luther doctor                          check CLIs, server, routes
  luther version
`

func main() {
	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	if cmd == "version" || cmd == "--version" || cmd == "-v" {
		fmt.Println("luther", protocol.Version)
		return
	}
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "luther:", err)
		os.Exit(1)
	}
	c := cli.New(cfg)
	args := os.Args[min(2, len(os.Args)):]
	switch cmd {
	case "serve":
		api.Serve(cfg)
	case "pair":
		err = c.Pair()
	case "tailscale":
		err = c.Tailscale(args)
	case "tunnel":
		err = c.Tunnel(args)
	case "service":
		err = c.Service(args)
	case "doctor":
		c.Doctor()
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "luther:", err)
		os.Exit(1)
	}
}

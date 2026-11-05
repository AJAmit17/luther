// Luther: the Mac-side server. Runs the coding agents (Claude Code, Codex) on
// this machine and serves them to paired phones. See docs/PLAN.md.
package main

import (
	"fmt"
	"os"
)

const version = "0.1.0-dev"

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
		fmt.Println("luther", version)
		return
	}
	var err error
	if cfg, err = loadConfig(); err != nil {
		fmt.Fprintln(os.Stderr, "luther:", err)
		os.Exit(1)
	}
	args := os.Args[min(2, len(os.Args)):]
	switch cmd {
	case "serve":
		serve()
	case "pair":
		err = pairCmd()
	case "tailscale":
		err = tailscaleCmd(args)
	case "tunnel":
		err = tunnelCmd(args)
	case "service":
		err = serviceCmd(args)
	case "doctor":
		doctorCmd()
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "luther:", err)
		os.Exit(1)
	}
}

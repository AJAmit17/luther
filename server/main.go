// Luther: the Mac-side server. Runs the coding agents (Claude Code, Codex) on
// this machine and serves them to paired phones. See docs/PLAN.md.
package main

import (
	"fmt"
	"os"
)

const version = "0.1.0-dev"

const usage = `usage:
  luther serve      run the server (launchd runs this)
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
	switch cmd {
	case "serve":
		serve()
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
}

// Luther: the Mac-side server. Runs the coding agents (Claude Code, Codex) on
// this machine and serves them to paired phones. See docs/PLAN.md.
package main

import (
	"fmt"
	"os"
)

const version = "0.0.0-dev"

func main() {
	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	switch cmd {
	case "version", "--version", "-v":
		fmt.Println("luther", version)
	case "serve":
		fmt.Fprintln(os.Stderr, "luther serve: not implemented yet (Phase 2)")
		os.Exit(1)
	default:
		fmt.Fprintf(os.Stderr, "usage: luther [serve | version]\n")
		os.Exit(2)
	}
}

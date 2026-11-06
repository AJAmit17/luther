// Luther: the Mac-side server. Runs the coding agents (Claude Code, Codex) on
// this machine and serves them to paired phones. See docs/PLAN.md; each feature
// is a package under internal/, wired together in internal/api.
package main

import (
	"os"

	"github.com/AJAmit17/luther/server/internal/api"
	"github.com/AJAmit17/luther/server/internal/cli"
)

func main() {
	if err := cli.Execute(os.Args[1:], os.Stdout, os.Stderr, api.Serve); err != nil {
		os.Exit(1)
	}
}

package claude

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
)

// ---- slash commands ----

var builtins = []protocol.Command{
	{Name: "/clear", Desc: "Clear conversation history"}, {Name: "/compact", Desc: "Compact conversation"},
	{Name: "/context", Desc: "Show context usage"}, {Name: "/cost", Desc: "Show token usage and cost"},
	{Name: "/model", Desc: "Switch model"}, {Name: "/effort", Desc: "Set reasoning effort"},
	{Name: "/init", Desc: "Create a CLAUDE.md for this project"}, {Name: "/review", Desc: "Review a pull request"},
	{Name: "/memory", Desc: "Edit memory files"}, {Name: "/status", Desc: "Show status"},
	{Name: "/help", Desc: "Show help"}, {Name: "/mcp", Desc: "Manage MCP servers"}, {Name: "/agents", Desc: "Manage subagents"},
}

var descRe = regexp.MustCompile(`(?m)^description:\s*["']?(.*?)["']?\s*$`)

// Commands: built-ins + custom commands (.claude/commands/**.md) + skills
// (.claude/skills/*/SKILL.md), from ~/.claude and <cwd>/.claude.
func Commands(cwd string) []protocol.Command {
	out := append([]protocol.Command{}, builtins...)
	desc := func(path string) string {
		b, _ := os.ReadFile(path)
		if m := descRe.FindSubmatch(b); m != nil {
			return text.Clip(string(m[1]), 120)
		}
		return ""
	}
	for _, root := range []string{filepath.Join(paths.Home, ".claude"), filepath.Join(cwd, ".claude")} {
		cmds := filepath.Join(root, "commands")
		filepath.WalkDir(cmds, func(p string, d os.DirEntry, err error) error {
			if err == nil && !d.IsDir() && strings.HasSuffix(p, ".md") {
				rel, _ := filepath.Rel(cmds, strings.TrimSuffix(p, ".md"))
				out = append(out, protocol.Command{Name: "/" + strings.ReplaceAll(rel, string(filepath.Separator), ":"), Desc: desc(p)})
			}
			return nil
		})
		skills, _ := filepath.Glob(filepath.Join(root, "skills", "*", "SKILL.md"))
		for _, p := range skills {
			out = append(out, protocol.Command{Name: "/" + filepath.Base(filepath.Dir(p)), Desc: desc(p)})
		}
	}
	return out
}

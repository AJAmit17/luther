// Package templates: agent roles. A role is ~/.luther/templates/<name>.md:
//
//	---
//	description: Reviews a change and lists what to fix
//	agent: codex        (optional: claude, codex, devin, …)
//	model: gpt-6-luna   (optional)
//	mode: plan          (optional: ask, edits, plan, full)
//	---
//	You are a careful reviewer. …
//
// The instructions go before the first message of a thread started with the
// role, from the phone or from another agent (start_thread). A file named like
// a built-in replaces it.
package templates

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

func Dir() string { return filepath.Join(config.Dir(), "templates") }

var nameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,39}$`)

var builtIn = []protocol.Template{{
	Name:        "reviewer",
	Description: "Reviews the current changes and reports what to fix; changes nothing",
	Mode:        protocol.ModePlan,
	Instructions: "You are reviewing someone else's change. Read the diff (git diff HEAD, plus untracked files) " +
		"and the code around it. Report, most important first: bugs and wrong behaviour, missing error handling, " +
		"security problems, then anything confusing. For each, give the file and line, what goes wrong, and the fix. " +
		"Do not edit files. If the change looks right, say so in one line.",
	BuiltIn: true,
}}

// List: built-ins, then your files, by name; a file replaces a built-in of its name.
func List() []protocol.Template {
	byName := map[string]protocol.Template{}
	for _, t := range builtIn {
		byName[t.Name] = t
	}
	ents, _ := os.ReadDir(Dir())
	for _, e := range ents {
		name := strings.TrimSuffix(e.Name(), ".md")
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") || !nameRe.MatchString(name) {
			continue
		}
		if t, ok := read(filepath.Join(Dir(), e.Name()), name); ok {
			byName[name] = t
		}
	}
	out := make([]protocol.Template, 0, len(byName))
	for _, t := range byName {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func Get(name string) (protocol.Template, bool) {
	for _, t := range List() {
		if t.Name == name {
			return t, true
		}
	}
	return protocol.Template{}, false
}

// read parses one role file; unknown keys and bad values are ignored.
func read(file, name string) (protocol.Template, bool) {
	b, err := os.ReadFile(file)
	if err != nil || len(b) > 64<<10 {
		return protocol.Template{}, false
	}
	t := protocol.Template{Name: name}
	body := string(b)
	if rest, ok := strings.CutPrefix(body, "---\n"); ok {
		if head, after, ok := strings.Cut(rest, "\n---"); ok {
			body = strings.TrimPrefix(after, "\n")
			sc := bufio.NewScanner(strings.NewReader(head))
			for sc.Scan() {
				k, v, ok := strings.Cut(sc.Text(), ":")
				if !ok {
					continue
				}
				v = strings.TrimSpace(v)
				switch strings.TrimSpace(k) {
				case "description":
					t.Description = v
				case "agent":
					t.Provider = protocol.Provider(v)
				case "model":
					t.Model = v
				case "mode":
					if protocol.ValidMode(v) {
						t.Mode = v
					}
				}
			}
		}
	}
	t.Instructions = strings.TrimSpace(body)
	return t, t.Instructions != ""
}

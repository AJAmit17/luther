package api

import (
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/AJAmit17/luther/server/internal/workspace"
)

// A walkthrough: a new thread, read-only in spirit, whose agent explains a
// change as an HTML page (show_artifact with the page itself, so it needs no
// write access). The change is a turn of a thread, or the uncommitted work in
// a repository.

const walkMax = 120 << 10 // diff bytes put in the prompt

const walkPrompt = `Explain this change to me as a walkthrough page I'll read on my phone.

Write one self-contained HTML page (inline CSS, no external requests) and show it with show_artifact, passing the page as html and a short title. Don't create or edit any files.

The page: a two-sentence summary of what changed and why; then each file or group of related hunks in a sensible reading order, with what it does, the important lines quoted in small code blocks, and why it matters; then risks, edge cases and what to test. Readable at phone width, in light and dark (prefers-color-scheme). Read the surrounding code in %s when the diff alone isn't enough.

When the page is shown, reply with its three most important points.

The change (%s):

` + "```diff\n%s\n```"

// noise: diff sections not worth an agent's attention.
var noise = regexp.MustCompile(`(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|go\.sum|Cargo\.lock|Podfile\.lock|composer\.lock|poetry\.lock)$|\.(min\.(js|css)|map|snap)$`)

func walkthrough(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Cwd      string            `json:"cwd"`
		Thread   string            `json:"thread"`
		Turn     int               `json:"turn"`
		Provider protocol.Provider `json:"provider"`
	}
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	diff, cwd, scope, prov, err := walkSource(req.Cwd, req.Thread, req.Turn)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	diff = clean(diff)
	if strings.TrimSpace(diff) == "" {
		http.Error(w, "No changes to walk through.", http.StatusBadRequest)
		return
	}
	if len(diff) > walkMax {
		diff = text.Clip(diff, walkMax) + "\n(cut here: the rest of the diff is too long to include)"
	}
	t, status, err := open(protocol.OpenReq{Provider: protocol.Provider(text.OrDefault(string(req.Provider), string(prov))), Cwd: cwd, Mode: protocol.ModeAsk})
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	if err := t.Send(fmt.Sprintf(walkPrompt, cwd, scope, diff), nil); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	httpx.WriteJSON(w, map[string]string{"id": t.ID})
}

// walkSource: the diff to explain, the folder to explain it in, a few words
// on what it is, and the agent to default to.
func walkSource(cwd, thread string, turn int) (diff, dir, scope string, prov protocol.Provider, err error) {
	prov = protocol.Claude
	if thread != "" {
		t := hub.Find(thread)
		if t == nil {
			return "", "", "", "", errors.New("that thread isn't open")
		}
		st := t.State()
		diff, err = t.TurnDiff(turn)
		return diff, st.Cwd, fmt.Sprintf("turn %d of a %s conversation in %s", turn, st.Provider.Name(), filepath.Base(st.Cwd)), st.Provider, err
	}
	if !paths.ProjectDir(cwd) {
		return "", "", "", "", errors.New("cwd must be an existing folder inside your home folder")
	}
	diff, err = workspace.WorkingDiff(cwd, 4*walkMax)
	return diff, cwd, "the uncommitted changes in " + filepath.Base(cwd), prov, err
}

// clean drops lockfiles, minified files, source maps and snapshots from a diff.
func clean(diff string) string {
	parts := strings.Split(diff, "\ndiff --git ")
	out := make([]string, 0, len(parts))
	for i, p := range parts {
		head, _, _ := strings.Cut(strings.TrimPrefix(p, "diff --git "), "\n")
		if f := strings.Fields(head); len(f) == 2 && noise.MatchString(strings.TrimPrefix(f[1], "b/")) {
			continue
		}
		if i > 0 {
			p = "diff --git " + p
		}
		out = append(out, p)
	}
	return strings.Join(out, "\n")
}

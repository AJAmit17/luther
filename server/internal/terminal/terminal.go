package terminal

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/coder/websocket"
)

// Package terminal: plain shells in tmux on a private socket (`tmux -L luther`), so
// they outlive phone disconnects and the user's own tmux is never touched. The
// phone gets the rendered pane (capture-pane -e: ANSI colours) and sends raw
// bytes; on the Mac, `tmux -L luther attach -t <name>` opens the same shell.

var tmuxSock = "luther"

var unsafeRe = regexp.MustCompile(`[^A-Za-z0-9_-]+`)

func tmux(args ...string) (string, error) {
	out, err := exec.Command("tmux", append([]string{"-L", tmuxSock}, args...)...).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("tmux %s: %v: %s", args[0], err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

func List() []protocol.Term {
	// Space-separated with cwd last (it may contain spaces): tmux 3.6 prints a tab in -F as "_".
	out, err := tmux("list-sessions", "-F", "#{session_name} #{session_attached} #{session_created} #{@luther_cwd}")
	if err != nil {
		return nil // no server running = no terminals
	}
	var ts []protocol.Term
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		f := strings.SplitN(line, " ", 4)
		if len(f) != 4 {
			continue
		}
		created, _ := strconv.ParseInt(f[2], 10, 64)
		ts = append(ts, protocol.Term{Name: f[0], Attached: f[1] != "0", Created: created, Cwd: f[3]})
	}
	return ts
}

func findTerm(name string) bool {
	for _, t := range List() {
		if t.Name == name {
			return true
		}
	}
	return false
}

func createTerm(cwd string) (string, error) {
	name := unsafeRe.ReplaceAllString(filepath.Base(cwd), "_") + "-" + text.RandHex(2)
	// tmux expands #{…} and #(command) in -c: a folder named like one must not run it.
	_, err := tmux("new-session", "-d", "-s", name, "-c", strings.ReplaceAll(cwd, "#", "##"),
		";", "set-option", "-t", "="+name+":", "@luther_cwd", cwd,
		";", "set-option", "-g", "status", "off",
		";", "set-option", "-g", "history-limit", "50000",
		";", "set-option", "-g", "mouse", "on",
		";", "set-option", "-g", "window-size", "latest", // whoever typed last sets the size
	)
	return name, err
}

// Routes: GET/POST /terms, DELETE /terms/{name}, WS /terms/{name}/events.
func Routes(mux *http.ServeMux, wrap httpx.Wrap) {
	mux.HandleFunc("GET /terms", wrap(func(w http.ResponseWriter, r *http.Request) { httpx.WriteJSON(w, httpx.OrEmpty(List())) }))
	mux.HandleFunc("POST /terms", wrap(newTerm))
	mux.HandleFunc("DELETE /terms/{name}", wrap(killTerm))
	mux.HandleFunc("GET /terms/{name}/events", wrap(events))
}

func newTerm(w http.ResponseWriter, r *http.Request) {
	var req struct{ Cwd string }
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	if !paths.ProjectDir(req.Cwd) {
		http.Error(w, "cwd must be an existing folder inside your home folder", http.StatusBadRequest)
		return
	}
	name, err := createTerm(req.Cwd)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	httpx.WriteJSON(w, map[string]string{"name": name})
}

func killTerm(w http.ResponseWriter, r *http.Request) {
	if _, err := tmux("kill-session", "-t", "="+r.PathValue("name")); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
	}
}

// termEvents: WS /terms/{name}/events. In: {type:"size",cols,rows}, {type:"input",hex}.
// Out: {type:"screen",ansi} whenever the pane changes, {type:"ended"}.
func events(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !findTerm(name) {
		http.Error(w, "no such terminal", http.StatusNotFound)
		return
	}
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true}) // origin check off: bearer auth, never cookies
	if err != nil {
		return
	}
	defer c.CloseNow()
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	errs := make(chan []byte, 8)
	go func() {
		defer cancel()
		for {
			_, data, err := c.Read(ctx)
			if err != nil {
				return
			}
			var m struct {
				Type, Hex  string
				Cols, Rows int
			}
			if json.Unmarshal(data, &m) != nil {
				continue
			}
			switch {
			case m.Type == "size" && m.Cols > 0 && m.Rows > 0:
				fitToPhone(name, m.Cols, m.Rows)
			case m.Type == "input":
				if err := sendHex(name, m.Hex); err != nil {
					b, _ := json.Marshal(map[string]string{"type": "error", "error": err.Error()})
					select {
					case errs <- b:
					default:
					}
				}
			}
		}
	}()

	// ponytail: 150ms capture-pane polling; a tmux control-mode client if it ever matters.
	tick := time.NewTicker(150 * time.Millisecond)
	defer tick.Stop()
	last := ""
	for n := 0; ; n++ {
		if n%14 == 0 && !findTerm(name) { // ~2s
			c.Write(ctx, websocket.MessageText, []byte(`{"type":"ended"}`))
			return
		}
		if ansi, err := tmux("capture-pane", "-p", "-e", "-t", "="+name+":"); err == nil && ansi != last {
			last = ansi
			b, _ := json.Marshal(map[string]string{"type": "screen", "ansi": ansi})
			if c.Write(ctx, websocket.MessageText, b) != nil {
				return
			}
		}
		select {
		case <-ctx.Done():
			return
		case b := <-errs:
			c.Write(ctx, websocket.MessageText, b)
		case <-tick.C:
		}
	}
}

func sendHex(name, h string) error {
	b, err := hex.DecodeString(h)
	if err != nil || len(b) == 0 || len(b) > 4096 {
		return fmt.Errorf("bad input")
	}
	args := []string{"send-keys", "-H", "-t", "=" + name + ":"}
	for _, x := range b {
		args = append(args, fmt.Sprintf("%02x", x))
	}
	_, err = tmux(args...)
	return err
}

// fitToPhone resizes the window to the phone, unless someone is attached on the
// Mac (an attached client owns the size).
func fitToPhone(name string, cols, rows int) {
	if out, _ := tmux("display-message", "-p", "-t", "="+name+":", "#{session_attached}"); strings.TrimSpace(out) == "0" {
		tmux("resize-window", "-t", "="+name+":", "-x", strconv.Itoa(cols), "-y", strconv.Itoa(rows))
	}
}

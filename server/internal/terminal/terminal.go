package terminal

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
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
	"github.com/creack/pty"
)

// Package terminal: plain shells in tmux on a private socket (`tmux -L luther`), so
// they outlive phone disconnects and the user's own tmux is never touched. Each
// phone attaches as a real tmux client in a pty (a native terminal view renders
// the raw stream); on the Mac, `tmux -L luther attach -t <name>` opens the same shell.

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
	_, err := tmux("new-session", "-d", "-s", name, "-c", cwd,
		";", "set-option", "-t", "="+name+":", "@luther_cwd", cwd,
		";", "set-option", "-g", "status", "off",
		";", "set-option", "-g", "history-limit", "50000",
		";", "set-option", "-g", "mouse", "on",
		";", "set-option", "-g", "window-size", "latest", // whoever typed last sets the size
		";", "set-option", "-g", "prefix", "None", // every key reaches the shell (Ctrl-B too)
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

// events: WS /terms/{name}/events — the phone as a real terminal client:
// `tmux attach` in a pty sized to the phone, its raw output streamed out, keys
// written in. tmux redraws the whole screen on attach and on resize, so a
// (re)connecting phone always starts from a full screen.
//
// Out: {type:"data", b64} (raw bytes), {type:"ended"} (the shell is gone).
// In: {type:"size", cols, rows} (first one sizes the pty), {type:"input", b64 | hex}.
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
	c.SetReadLimit(1 << 20)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	type frame struct {
		Type, Hex, B64 string
		Cols, Rows     int
	}
	read := func() (frame, error) {
		var m frame
		_, data, err := c.Read(ctx)
		if err == nil {
			json.Unmarshal(data, &m)
		}
		return m, err
	}
	// The phone announces its size first; wait briefly for it.
	size := &pty.Winsize{Cols: 80, Rows: 24}
	first := make(chan frame, 1)
	go func() {
		if m, err := read(); err == nil {
			first <- m
		} else {
			cancel()
		}
	}()
	var pending *frame
	select {
	case m := <-first:
		if m.Type == "size" && m.Cols > 0 && m.Rows > 0 {
			size = &pty.Winsize{Cols: uint16(min(m.Cols, 500)), Rows: uint16(min(m.Rows, 300))}
		} else {
			pending = &m
		}
	case <-time.After(2 * time.Second):
	case <-ctx.Done():
		return
	}

	cmd := exec.Command("tmux", "-L", tmuxSock, "attach-session", "-t", "="+name)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "LANG=en_US.UTF-8")
	f, err := pty.StartWithSize(cmd, size)
	if err != nil {
		b, _ := json.Marshal(map[string]string{"type": "error", "error": "can't attach: " + err.Error()})
		c.Write(ctx, websocket.MessageText, b)
		return
	}
	defer func() {
		f.Close()
		cmd.Process.Kill() // detaches this client; the shell keeps running
		cmd.Wait()
	}()

	handle := func(m frame) {
		switch {
		case m.Type == "size" && m.Cols > 0 && m.Rows > 0:
			pty.Setsize(f, &pty.Winsize{Cols: uint16(min(m.Cols, 500)), Rows: uint16(min(m.Rows, 300))})
		case m.Type == "input":
			var b []byte
			if m.B64 != "" {
				b, _ = base64.StdEncoding.DecodeString(m.B64)
			} else {
				b, _ = hex.DecodeString(m.Hex)
			}
			if len(b) > 0 && len(b) <= 64<<10 {
				f.Write(b)
			}
		}
	}
	if pending != nil {
		handle(*pending)
	}
	go func() { // phone → pty
		defer cancel()
		for {
			m, err := read()
			if err != nil {
				return
			}
			handle(m)
		}
	}()

	buf := make([]byte, 32<<10)
	for { // pty → phone
		n, err := f.Read(buf)
		if n > 0 {
			b, _ := json.Marshal(map[string]string{"type": "data", "b64": base64.StdEncoding.EncodeToString(buf[:n])})
			if c.Write(ctx, websocket.MessageText, b) != nil {
				return
			}
		}
		if err != nil {
			if !findTerm(name) {
				c.Write(ctx, websocket.MessageText, []byte(`{"type":"ended"}`))
			}
			c.Close(websocket.StatusNormalClosure, "")
			return
		}
	}
}

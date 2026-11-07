// Package remote: agents on other machines (a dev server, a cloud box) reached
// over SSH. Each remote runs its own `luther serve`; this machine keeps an
// `ssh -L` forward to it and relays it at /r/<name>/… on its own routes, so the
// remote needs no public route of its own. The phone pairs with the remote
// itself (through the relay): the remote checks the tokens, and with end-to-end
// encryption this machine relays only ciphertext. Remotes live in
// ~/.luther/remotes.json; `luther remote add|pair|list|remove` manage them.
package remote

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/AJAmit17/luther/server/internal/auth"
	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/env"
	"github.com/AJAmit17/luther/server/internal/httpx"
)

// Remote: one machine reached over ssh.
type Remote struct {
	Name   string `json:"name"`             // in URLs: /r/<name>
	Target string `json:"target"`           // ssh destination: user@host or a Host from ~/.ssh/config
	Local  int    `json:"local"`            // forwarded to 127.0.0.1:<local> here
	Port   int    `json:"port,omitempty"`   // luther's port there (default 47900)
	SSHArg string `json:"sshArg,omitempty"` // e.g. "-p 2222" (ponytail: one extra flag; ~/.ssh/config covers the rest)
}

// Status: a remote and whether its forward is up.
type Status struct {
	Remote
	Up    bool   `json:"up"`
	Error string `json:"error,omitempty"`
}

var NameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)

func file() string { return filepath.Join(config.Dir(), "remotes.json") }

// Load: the configured remotes.
func Load() ([]Remote, error) {
	b, err := os.ReadFile(file())
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var rs []Remote
	return rs, json.Unmarshal(b, &rs)
}

// Save: the remotes, for the next (re)load.
func Save(rs []Remote) error {
	sort.Slice(rs, func(i, j int) bool { return rs[i].Name < rs[j].Name })
	b, _ := json.MarshalIndent(rs, "", "  ")
	os.MkdirAll(config.Dir(), 0o700)
	return os.WriteFile(file(), b, 0o600)
}

// FreePort: a local port for a new forward, from 47910 up, unused by the others.
func FreePort(rs []Remote) int {
	used := map[int]bool{}
	for _, r := range rs {
		used[r.Local] = true
	}
	for p := 47910; p < 48900; p++ {
		if used[p] {
			continue
		}
		if l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p)); err == nil {
			l.Close()
			return p
		}
	}
	return 0
}

// SSH: the ssh command line for args on r (BatchMode: never prompt from a daemon).
func SSH(r Remote, args ...string) *exec.Cmd {
	a := []string{"-o", "BatchMode=yes", "-o", "ConnectTimeout=10"}
	if r.SSHArg != "" {
		a = append(a, splitArg(r.SSHArg)...)
	}
	return exec.Command("ssh", append(append(a, r.Target), args...)...)
}

func splitArg(s string) []string {
	var out []string
	for _, f := range regexp.MustCompile(`\s+`).Split(s, -1) {
		if f != "" {
			out = append(out, f)
		}
	}
	return out
}

// forwardArgs: ssh -N -L for r.
func forwardArgs(r Remote) []string {
	port := r.Port
	if port == 0 {
		port = 47900
	}
	return []string{"-N", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
		"-L", fmt.Sprintf("127.0.0.1:%d:127.0.0.1:%d", r.Local, port)}
}

// ---- in `luther serve` ----

type manager struct {
	mu      sync.Mutex
	remotes map[string]*Status
	cancel  context.CancelFunc
}

var m = &manager{remotes: map[string]*Status{}}

// Start: the forwards (kept up, restarted with backoff) and the routes:
// /r/{name}/… (the relay; the remote authenticates), GET /remotes, and
// POST /remotes/reload (admin: the CLI after a change).
func Start(mux *http.ServeMux, wrap httpx.Wrap, admin func(*http.Request) bool) {
	m.reload()
	mux.HandleFunc("/r/{name}/{rest...}", relay)
	mux.HandleFunc("GET /remotes", wrap(func(w http.ResponseWriter, r *http.Request) { httpx.WriteJSON(w, m.list()) }))
	mux.HandleFunc("POST /remotes/reload", wrap(func(w http.ResponseWriter, r *http.Request) {
		if !admin(r) {
			http.Error(w, "admin only", http.StatusForbidden)
			return
		}
		if err := m.reload(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	}))
}

func (m *manager) list() []Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Status{}
	for _, s := range m.remotes {
		out = append(out, *s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func (m *manager) reload() error {
	rs, err := Load()
	if err != nil {
		return err
	}
	m.mu.Lock()
	if m.cancel != nil {
		m.cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.cancel = cancel
	m.remotes = map[string]*Status{}
	for _, r := range rs {
		st := &Status{Remote: r}
		m.remotes[r.Name] = st
		go m.forward(ctx, st)
	}
	m.mu.Unlock()
	return nil
}

func (m *manager) set(st *Status, up bool, err string) {
	m.mu.Lock()
	st.Up, st.Error = up, err
	m.mu.Unlock()
}

// forward keeps `ssh -N -L` running for st until ctx ends.
func (m *manager) forward(ctx context.Context, st *Status) {
	backoff := 2 * time.Second
	for ctx.Err() == nil {
		cmd := SSH(st.Remote, forwardArgs(st.Remote)...)
		tail := &env.LogTail{Prefix: "ssh " + st.Name + ": "}
		cmd.Stderr = tail
		if err := cmd.Start(); err != nil {
			m.set(st, false, err.Error())
		} else {
			started := time.Now()
			done := make(chan error, 1)
			go func() { done <- cmd.Wait() }()
			go func() { // up once the forward answers
				for i := 0; i < 20 && ctx.Err() == nil; i++ {
					time.Sleep(500 * time.Millisecond)
					if c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", st.Local), time.Second); err == nil {
						c.Close()
						m.set(st, true, "")
						return
					}
				}
			}()
			select {
			case <-ctx.Done():
				cmd.Process.Kill()
				<-done
				return
			case err := <-done:
				m.set(st, false, fmt.Sprintf("ssh exited: %v", err))
				if time.Since(started) > time.Minute {
					backoff = 2 * time.Second // it had been working
				}
			}
		}
		log.Printf("remote %s: forward down, retrying in %s", st.Name, backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 2*time.Minute)
	}
}

var errNoRemote = errors.New("no such remote")

// relay: /r/{name}/rest → the remote's luther, through the forward. WebSockets
// pass through; the remote sees the original headers (Cf-Ray included).
func relay(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	st := m.remotes[r.PathValue("name")]
	var local int
	if st != nil {
		local = st.Local
	}
	m.mu.Unlock()
	if st == nil {
		http.Error(w, errNoRemote.Error(), http.StatusNotFound)
		return
	}
	target := &url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", local)}
	rest := "/" + r.PathValue("rest")
	(&httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.URL.Path, pr.Out.URL.RawPath = rest, ""
			pr.Out.Host = target.Host
			// The phone's token for the remote passes; this Mac's own internal
			// token (a sealed request re-dispatched here) must never leave it.
			if strings.HasPrefix(pr.Out.Header.Get("Authorization"), "Bearer "+auth.InternalPrefix) {
				pr.Out.Header.Del("Authorization")
			}
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, fmt.Sprintf("remote %s is unreachable (ssh forward down?)", st.Name), http.StatusBadGateway)
		},
	}).ServeHTTP(w, r)
}

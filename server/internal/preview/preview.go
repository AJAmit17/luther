// Package preview: your dev server (localhost:3000…) on the phone. The phone
// asks for a preview of a port and gets a one-time path; opening it in a
// browser sets a cookie and redirects to "/", and from then on every request
// that carries the cookie and isn't one of Luther's own routes is proxied to
// that port. A browser can't send the bearer token, so the random path and
// cookie are the credential: short-lived, bound to one port, loopback only.
package preview

import (
	"bufio"
	"bytes"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
)

const (
	cookie = "luther_preview"
	ttl    = 12 * time.Hour
)

type grant struct {
	port    int
	expires time.Time
}

var grants = struct {
	sync.Mutex
	m map[string]grant
}{m: map[string]grant{}}

// Routes: GET /ports, POST /previews (both bearer-authed), and the open
// preview paths. Call it last: it owns "/" (everything no other route claims).
// ponytail: a dev app's own paths that collide with Luther's (/files, /events…)
// reach Luther, not the app; a host-per-preview would avoid that.
func Routes(mux *http.ServeMux, wrap httpx.Wrap, self int) {
	mux.HandleFunc("GET /ports", wrap(func(w http.ResponseWriter, r *http.Request) { httpx.WriteJSON(w, Ports(self)) }))
	mux.HandleFunc("POST /previews", wrap(func(w http.ResponseWriter, r *http.Request) {
		var req struct{ Port int }
		if !httpx.ReadJSON(w, r, &req) {
			return
		}
		if req.Port <= 0 || req.Port > 65535 || req.Port == self {
			http.Error(w, "pick a dev server's port", http.StatusBadRequest)
			return
		}
		tok := text.RandHex(16)
		grants.Lock()
		grants.m[tok] = grant{req.Port, time.Now().Add(ttl)}
		grants.Unlock()
		httpx.WriteJSON(w, map[string]string{"path": "/p/" + tok + "/"})
	}))
	mux.HandleFunc("/p/{token}/{rest...}", func(w http.ResponseWriter, r *http.Request) {
		tok := r.PathValue("token")
		if _, ok := lookup(tok); !ok {
			http.Error(w, "This preview link expired. Open it again from Luther.", http.StatusGone)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: cookie, Value: tok, Path: "/", HttpOnly: true, Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https", SameSite: http.SameSiteLaxMode, MaxAge: int(ttl.Seconds())})
		to := "/" + r.PathValue("rest")
		if r.URL.RawQuery != "" {
			to += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, to, http.StatusFound)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookie)
		var port int
		var ok bool
		if err == nil {
			port, ok = lookup(c.Value)
		}
		if !ok {
			http.NotFound(w, r)
			return
		}
		proxy(port).ServeHTTP(w, r)
	})
}

func lookup(tok string) (int, bool) {
	grants.Lock()
	defer grants.Unlock()
	g, ok := grants.m[tok]
	if ok && time.Now().After(g.expires) {
		delete(grants.m, tok)
		ok = false
	}
	return g.port, ok
}

// proxy: to the dev server as if the request were local (Vite and friends
// refuse unknown Host headers). WebSocket upgrades (hot reload) pass through.
func proxy(port int) http.Handler {
	target := &url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", port)}
	return &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.Host = fmt.Sprintf("localhost:%d", port)
			pr.Out.Header.Del("Authorization")
			if pr.Out.Header.Get("Origin") != "" {
				pr.Out.Header.Set("Origin", "http://"+pr.Out.Host)
			}
			// The preview cookie is ours, not the app's.
			var keep []string
			for _, c := range pr.In.Cookies() {
				if c.Name != cookie {
					keep = append(keep, c.Name+"="+c.Value)
				}
			}
			pr.Out.Header.Del("Cookie")
			if len(keep) > 0 {
				pr.Out.Header.Set("Cookie", strings.Join(keep, "; "))
			}
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, fmt.Sprintf("Nothing answers on port %d. Is the dev server still running?", port), http.StatusBadGateway)
		},
	}
}

// Ports: TCP ports your processes listen on, with the command and its folder.
// System listeners (ports below 1024, AirPlay's 5000/7000) and Luther itself
// are left out.
func Ports(self int) []protocol.Port {
	out, _ := exec.Command("lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn").Output()
	seen := map[int]bool{self: true}
	var ports []protocol.Port
	var pid, cmd string
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		l := sc.Text()
		if l == "" {
			continue
		}
		switch l[0] {
		case 'p':
			pid = l[1:]
		case 'c':
			cmd = l[1:]
		case 'n':
			i := strings.LastIndex(l, ":")
			port, err := strconv.Atoi(l[i+1:])
			if err != nil || port < 1024 || seen[port] || cmd == "ControlCenter" || cmd == "rapportd" {
				continue
			}
			seen[port] = true
			ports = append(ports, protocol.Port{Port: port, Command: cmd, Cwd: cwdOf(pid)})
		}
	}
	// Ones running in a project folder (dev servers) first.
	proj := func(p protocol.Port) bool { return p.Cwd != "" && !strings.Contains(p.Cwd, "/Library/") }
	sort.Slice(ports, func(i, j int) bool {
		if proj(ports[i]) != proj(ports[j]) {
			return proj(ports[i])
		}
		return ports[i].Port < ports[j].Port
	})
	if ports == nil {
		ports = []protocol.Port{}
	}
	return ports
}

func cwdOf(pid string) string {
	out, _ := exec.Command("lsof", "-a", "-p", pid, "-d", "cwd", "-Fn").Output()
	for _, l := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(l, "n/") {
			if d := l[1:]; d != "/" && strings.HasPrefix(d, home) {
				return d
			}
		}
	}
	return ""
}

var home, _ = os.UserHomeDir()

package remote

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// The relay without ssh: a stand-in for the remote's luther on the forward's port.
func TestRelay(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	go http.Serve(ln, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ws" {
			c, err := websocket.Accept(w, r, nil)
			if err != nil {
				return
			}
			_, b, _ := c.Read(r.Context())
			c.Write(r.Context(), websocket.MessageText, append([]byte("echo:"), b...))
			c.Close(websocket.StatusNormalClosure, "")
			return
		}
		io.WriteString(w, "remote saw "+r.URL.RequestURI()+" ray="+r.Header.Get("Cf-Ray"))
	}))
	m.remotes = map[string]*Status{"box": {Remote: Remote{Name: "box", Local: ln.Addr().(*net.TCPAddr).Port}}}
	mux := http.NewServeMux()
	mux.HandleFunc("/r/{name}/{rest...}", relay)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/r/box/threads/abc/turns?x=1", nil)
	req.Header.Set("Cf-Ray", "r1")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	if got := string(b); got != "remote saw /threads/abc/turns?x=1 ray=r1" {
		t.Errorf("relay: %q", got)
	}
	if res, _ := http.Get(srv.URL + "/r/nope/healthz"); res.StatusCode != 404 {
		t.Errorf("unknown remote: %d", res.StatusCode)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, strings.Replace(srv.URL, "http", "ws", 1)+"/r/box/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	c.Write(ctx, websocket.MessageText, []byte("hi"))
	_, got, err := c.Read(ctx)
	if err != nil || string(got) != "echo:hi" {
		t.Errorf("ws: %q %v", got, err)
	}
}

func TestForwardArgs(t *testing.T) {
	got := strings.Join(SSH(Remote{Target: "me@box", SSHArg: "-p 2222", Local: 47910}, forwardArgs(Remote{Local: 47910})...).Args, " ")
	want := "ssh -o BatchMode=yes -o ConnectTimeout=10 -p 2222 me@box -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:47910:127.0.0.1:47900"
	if got != want {
		t.Errorf("\n got %s\nwant %s", got, want)
	}
}

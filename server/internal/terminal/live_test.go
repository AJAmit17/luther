package terminal

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// A shell over the socket: type a command, see its output in the raw stream.
func TestLiveAttach(t *testing.T) {
	if _, err := os.Stat("/opt/homebrew/bin/tmux"); err != nil {
		if _, err := os.Stat("/usr/bin/tmux"); err != nil {
			t.Skip("no tmux")
		}
	}
	tmuxSock = "luther-test"
	defer tmux("kill-server")
	name, err := createTerm(os.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /terms/{name}/events", events)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, strings.Replace(srv.URL, "http", "ws", 1)+"/terms/"+name+"/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	c.Write(ctx, websocket.MessageText, []byte(`{"type":"size","cols":100,"rows":30}`))
	c.Write(ctx, websocket.MessageText, []byte(`{"type":"input","b64":"`+base64.StdEncoding.EncodeToString([]byte("echo luther-$((40+2))\r"))+`"}`))
	var got strings.Builder
	for !strings.Contains(got.String(), "luther-42") {
		_, b, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("no output: %v\n%q", err, got.String())
		}
		var f struct{ Type, B64 string }
		json.Unmarshal(b, &f)
		raw, _ := base64.StdEncoding.DecodeString(f.B64)
		got.Write(raw)
	}
	if out, _ := tmux("display-message", "-p", "-t", "="+name+":", "#{window_width}x#{window_height}"); strings.TrimSpace(out) != "100x30" {
		t.Errorf("window size %q, want 100x30", strings.TrimSpace(out))
	}
}

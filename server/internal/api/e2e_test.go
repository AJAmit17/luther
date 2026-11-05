package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/seal"
)

// The phone's side of end-to-end encryption against the whole server: sealed
// pairing, a sealed request, a sealed WebSocket, and what a relay can't do.
func TestEndToEnd(t *testing.T) {
	paths.Home = t.TempDir() // config, devices: never the real ~/.luther
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	cfg.Port = ln.Addr().(*net.TCPAddr).Port
	srv := &http.Server{Handler: Handler(cfg)}
	go srv.Serve(ln)
	defer srv.Close()
	base := fmt.Sprintf("http://127.0.0.1:%d", cfg.Port)

	// pair: code from the CLI's admin call, sealed to the server's key
	req, _ := http.NewRequest("POST", base+"/pair/code", nil)
	req.Header.Set("Authorization", "Bearer "+cfg.AdminToken)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var code struct{ Code string }
	json.NewDecoder(res.Body).Decode(&code)

	phonePriv := seal.NewKey()
	phonePub, _ := seal.Public(phonePriv)
	key, _ := seal.Client(phonePriv, cfg.PublicKey())
	in, _ := json.Marshal(map[string]any{"code": code.Code, "name": "Test phone", "t": time.Now().UnixMilli()})
	body, _ := json.Marshal(map[string]string{"pub": phonePub, "box": base64.StdEncoding.EncodeToString(seal.Box(key, "pair", in))})
	res, err = http.Post(base+"/pair", "application/json", bytes.NewReader(body))
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("pair: %v %v", err, res.Status)
	}
	var pr struct{ Box string }
	json.NewDecoder(res.Body).Decode(&pr)
	b, _ := base64.StdEncoding.DecodeString(pr.Box)
	plain, err := seal.Open(key, "pair-res", b)
	if err != nil {
		t.Fatal(err)
	}
	var dev struct{ DeviceId, Token string }
	json.Unmarshal(plain, &dev)
	if dev.DeviceId == "" || dev.Token == "" {
		t.Fatalf("pair answer: %s", plain)
	}

	// a sealed request
	call := func(m, p, n string, body []byte) (int, string) {
		h, _ := json.Marshal(map[string]any{"m": m, "p": p, "t": time.Now().UnixMilli(), "n": n, "h": map[string]string{"Content-Type": "application/json"}})
		box := seal.Box(key, "req", append(append(h, '\n'), body...))
		req, _ := http.NewRequest("POST", base+"/e", bytes.NewReader(box))
		req.Header.Set("X-Luther-Device", dev.DeviceId)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(res.Body)
		if res.StatusCode != 200 {
			return res.StatusCode, string(raw)
		}
		plain, err := seal.Open(key, "res:"+n, raw)
		if err != nil {
			t.Fatal(err)
		}
		hj, body, _ := bytes.Cut(plain, []byte("\n"))
		var rh struct{ S int }
		json.Unmarshal(hj, &rh)
		return rh.S, string(body)
	}
	if s, body := call("GET", "/devices", "n1", nil); s != 200 || !strings.Contains(body, `"encrypted":true`) {
		t.Fatalf("GET /devices: %d %s", s, body)
	}
	if s, _ := call("GET", "/devices", "n1", nil); s != 401 {
		t.Fatalf("replayed id answered %d", s)
	}
	if s, _ := call("GET", "/e", "n2", nil); s != 401 {
		t.Fatalf("nested /e answered %d", s)
	}

	// plain requests with its token: fine locally / on the tailnet, refused via Cloudflare
	plainGet := func(cf bool) int {
		req, _ := http.NewRequest("GET", base+"/devices", nil)
		req.Header.Set("Authorization", "Bearer "+dev.Token)
		if cf {
			req.Header.Set("Cf-Ray", "8f00000000000000-SJC")
		}
		res, _ := http.DefaultClient.Do(req)
		return res.StatusCode
	}
	if plainGet(false) != 200 || plainGet(true) != 403 {
		t.Fatal("Cloudflare plaintext rule")
	}

	// a sealed WebSocket: the run feed (an open thread list would need agents)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	open, _ := json.Marshal(map[string]any{"p": "/events", "t": time.Now().UnixMilli(), "n": "w1"})
	u := fmt.Sprintf("ws://127.0.0.1:%d/e/ws?d=%s&b=%s", cfg.Port, dev.DeviceId, base64.RawURLEncoding.EncodeToString(seal.Box(key, "ws-open", open)))
	c, _, err := websocket.Dial(ctx, u, nil)
	if err != nil {
		t.Fatal("sealed socket:", err)
	}
	c.Close(websocket.StatusNormalClosure, "")
	// frames both ways: a terminal sends its screen at once
	if _, err := exec.LookPath("tmux"); err == nil {
		st, body := call("POST", "/terms", "n3", []byte(fmt.Sprintf(`{"cwd":%q}`, paths.Home)))
		var term struct{ Name string }
		json.Unmarshal([]byte(body), &term)
		if st != 200 || term.Name == "" {
			t.Fatalf("POST /terms: %d %s", st, body)
		}
		defer call("DELETE", "/terms/"+term.Name, "n4", nil)
		open, _ := json.Marshal(map[string]any{"p": "/terms/" + term.Name + "/events", "t": time.Now().UnixMilli(), "n": "w2"})
		c, _, err := websocket.Dial(ctx, fmt.Sprintf("ws://127.0.0.1:%d/e/ws?d=%s&b=%s", cfg.Port, dev.DeviceId, base64.RawURLEncoding.EncodeToString(seal.Box(key, "ws-open", open))), nil)
		if err != nil {
			t.Fatal(err)
		}
		defer c.CloseNow()
		c.Write(ctx, websocket.MessageBinary, seal.Box(key, "ws>:w2:0", []byte(`{"type":"size","cols":80,"rows":24}`)))
		_, b, err := c.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		plain, err := seal.Open(key, "ws<:w2:0", b)
		if err != nil || !strings.Contains(string(plain), `"data"`) {
			t.Fatalf("first frame: %v %.80s", err, plain)
		}
	}

	// a forged opener is refused
	bad := seal.Box(make([]byte, 32), "ws-open", open)
	if _, _, err := websocket.Dial(ctx, fmt.Sprintf("ws://127.0.0.1:%d/e/ws?d=%s&b=%s", cfg.Port, dev.DeviceId, base64.RawURLEncoding.EncodeToString(bad)), nil); err == nil {
		t.Fatal("forged socket opened")
	}
}

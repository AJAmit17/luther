// Package e2e: end-to-end encrypted transport for paired phones. A relay (the
// Cloudflare tunnel terminates TLS) sees only the device id and ciphertext.
//
//	POST /e   header X-Luther-Device: <id>; body = box(aad "req",
//	          {m, p, h, t, n} "\n" body) → box(aad "res:<n>", {s, h} "\n" body)
//	GET /e/ws?d=<id>&b=<base64url box(aad "ws-open", {p, t, n})>
//	          then binary frames: phone→server box(aad "ws>:<n>:<seq>", text),
//	          server→phone box(aad "ws<:<n>:<seq>", text); seq counts from 0 per direction
//
// t is the phone's clock (ms) and n a random id: boxes older than two minutes, or
// seen before, are refused. Decrypted requests are re-dispatched to the normal
// routes with an internal token for that device (auth.Internal), so every
// feature works unchanged behind it.
package e2e

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/AJAmit17/luther/server/internal/seal"
)

// Keys: what e2e needs from auth.
type Keys interface {
	Key(device string) ([]byte, error)
	Internal(device string) string
}

const (
	window  = 2 * time.Minute
	maxBody = 40 << 20 // uploads are 25 MB
)

type head struct {
	M string            `json:"m,omitempty"` // method
	P string            `json:"p"`           // path and query
	H map[string]string `json:"h,omitempty"` // headers
	T int64             `json:"t"`           // phone clock, ms
	N string            `json:"n"`           // random id
	S int               `json:"s,omitempty"` // response status
}

// Routes: POST /e and GET /e/ws. inner serves the decrypted requests; port is
// where this server listens (WebSockets are bridged to it).
func Routes(mux *http.ServeMux, keys Keys, inner http.Handler, port int) {
	s := &server{keys: keys, inner: inner, port: port, seen: map[string]time.Time{}}
	mux.HandleFunc("POST /e", s.request)
	mux.HandleFunc("GET /e/ws", s.socket)
}

type server struct {
	keys  Keys
	inner http.Handler
	port  int

	mu   sync.Mutex
	seen map[string]time.Time // n → when, for replay refusal
}

// fresh: t is recent and n unseen (then remembered).
func (s *server) fresh(h head) bool {
	// Not before this process started: the seen-list is lost on a restart, so
	// a box recorded earlier must not replay into the new one.
	if h.N == "" || time.Since(time.UnixMilli(h.T)).Abs() > window || time.UnixMilli(h.T).Before(started) {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for n, at := range s.seen {
		if time.Since(at) > 2*window {
			delete(s.seen, n)
		}
	}
	if _, dup := s.seen[h.N]; dup {
		return false
	}
	s.seen[h.N] = time.Now()
	return true
}

// open: a box from device under aad, split into its head and body.
func (s *server) open(device, aad string, box []byte) (head, []byte, []byte, error) {
	key, err := s.keys.Key(device)
	if err != nil {
		return head{}, nil, nil, err
	}
	plain, err := seal.Open(key, aad, box)
	if err != nil {
		return head{}, nil, nil, err
	}
	hj, body, _ := bytes.Cut(plain, []byte("\n"))
	var h head
	if json.Unmarshal(hj, &h) != nil || !strings.HasPrefix(h.P, "/") || ours(h.P) {
		return head{}, nil, nil, fmt.Errorf("bad request inside the box")
	}
	if !s.fresh(h) {
		return head{}, nil, nil, fmt.Errorf("stale or replayed request (check the phone's clock)")
	}
	return h, body, key, nil
}

// reading caps how many request bodies are read at once (each up to maxBody).
var reading = make(chan struct{}, 8)

func (s *server) request(w http.ResponseWriter, r *http.Request) {
	device := r.Header.Get("X-Luther-Device")
	// Who's asking first: nothing is read for a device that isn't paired.
	if _, err := s.keys.Key(device); err != nil {
		http.Error(w, "unknown device", http.StatusUnauthorized)
		return
	}
	reading <- struct{}{}
	box, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	<-reading
	if err != nil {
		http.Error(w, "too large", http.StatusRequestEntityTooLarge)
		return
	}
	h, body, key, err := s.open(device, "req", box)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	in, err := http.NewRequestWithContext(r.Context(), h.M, h.P, bytes.NewReader(body))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	for k, v := range h.H {
		in.Header.Set(k, v)
	}
	in.Header.Set("Authorization", "Bearer "+s.keys.Internal(device))
	in.RemoteAddr = r.RemoteAddr
	rec := httptest.NewRecorder() // ponytail: buffers the whole answer; fine for JSON and files ≤ the read caps
	s.inner.ServeHTTP(rec, in)
	out, _ := json.Marshal(head{S: rec.Code, H: map[string]string{"Content-Type": rec.Header().Get("Content-Type")}, N: h.N})
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Write(seal.Box(key, "res:"+h.N, append(append(out, '\n'), rec.Body.Bytes()...)))
}

func (s *server) socket(w http.ResponseWriter, r *http.Request) {
	device := r.URL.Query().Get("d")
	box, err := base64.RawURLEncoding.DecodeString(r.URL.Query().Get("b"))
	if err != nil {
		http.Error(w, "bad box", http.StatusBadRequest)
		return
	}
	h, _, key, err := s.open(device, "ws-open", box)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	// The real socket, on this server, as that device.
	local, _, err := websocket.Dial(ctx, fmt.Sprintf("ws://127.0.0.1:%d%s", s.port, h.P), &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + s.keys.Internal(device)}},
	})
	if err != nil {
		http.Error(w, "can't open "+h.P+": "+err.Error(), http.StatusBadGateway)
		return
	}
	defer local.CloseNow()
	local.SetReadLimit(16 << 20)
	phone, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true}) // bearer-less: the box is the credential
	if err != nil {
		return
	}
	defer phone.CloseNow()
	phone.SetReadLimit(16 << 20)

	// Every 5 s: a revoked phone loses the socket (a terminal included); every
	// 25 s a ping keeps the leg alive through tunnels and mobile NATs.
	go func() {
		t := time.NewTicker(5 * time.Second)
		defer t.Stop()
		for tick := 1; ; tick++ {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if _, err := s.keys.Key(device); err != nil {
					phone.Close(websocket.StatusPolicyViolation, "this phone was removed")
					cancel()
					return
				}
				if tick%5 != 0 {
					continue
				}
				pctx, done := context.WithTimeout(ctx, 10*time.Second)
				err := phone.Ping(pctx)
				done()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()
	go func() { // phone → server
		defer cancel()
		for seq := 0; ; seq++ {
			_, b, err := phone.Read(ctx)
			if err != nil {
				return
			}
			plain, err := seal.Open(key, fmt.Sprintf("ws>:%s:%d", h.N, seq), b)
			if err != nil || local.Write(ctx, websocket.MessageText, plain) != nil {
				return
			}
		}
	}()
	for seq := 0; ; seq++ { // server → phone
		_, b, err := local.Read(ctx)
		if err != nil {
			phone.Close(websocket.StatusNormalClosure, "")
			return
		}
		if phone.Write(ctx, websocket.MessageBinary, seal.Box(key, fmt.Sprintf("ws<:%s:%d", h.N, seq), b)) != nil {
			return
		}
	}
}

// ours: paths a box may not name: /e itself, and /r/ (a relay to another
// machine, which must never receive this one's internal token).
func ours(p string) bool {
	p, _, _ = strings.Cut(p, "?")
	return p == "/e" || strings.HasPrefix(p, "/e/") || strings.HasPrefix(p, "/r/")
}

var started = time.Now().Add(-time.Second) // the clock check's own slack

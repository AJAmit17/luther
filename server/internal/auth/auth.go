// Package auth: every route needs "Authorization: Bearer <token>". Phones get a
// per-device token by trading a one-time pairing code (`luther pair`); the local
// CLI uses the admin token from config. Both the tailnet proxy and the Cloudflare
// tunnel arrive from localhost, so localhost is never trusted.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
)

const (
	Admin        = "admin" // DeviceID of the local CLI
	codeTTL      = 10 * time.Minute
	codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O/1/I
)

type ctxKey struct{}

type Auth struct {
	cfg   *config.Config
	mu    sync.Mutex
	codes map[string]time.Time
}

func New(cfg *config.Config) *Auth { return &Auth{cfg: cfg, codes: map[string]time.Time{}} }

func hashToken(t string) string { s := sha256.Sum256([]byte(t)); return hex.EncodeToString(s[:]) }

// deviceFor: the device id for a token (Admin for the CLI), or "".
func (a *Auth) deviceFor(tok string) string {
	if tok == "" {
		return ""
	}
	if subtle.ConstantTimeCompare([]byte(tok), []byte(a.cfg.AdminToken)) == 1 {
		return Admin
	}
	h := hashToken(tok)
	return a.cfg.FindDevice(func(d config.Device) bool { return subtle.ConstantTimeCompare([]byte(h), []byte(d.TokenHash)) == 1 })
}

// Wrap rejects requests without a valid token; DeviceID(r) names the caller.
func (a *Auth) Wrap(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := a.deviceFor(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		if id == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if id != Admin {
			a.cfg.Touch(id)
		}
		h(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, id)))
	}
}

func DeviceID(r *http.Request) string { id, _ := r.Context().Value(ctxKey{}).(string); return id }

// Routes: POST /pair (no auth), POST /pair/code (admin), GET /devices, DELETE /devices/{id}.
func (a *Auth) Routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /pair", a.pair)
	mux.HandleFunc("POST /pair/code", a.Wrap(a.pairCode))
	mux.HandleFunc("GET /devices", a.Wrap(func(w http.ResponseWriter, r *http.Request) { httpx.WriteJSON(w, a.cfg.ListDevices()) }))
	// Any paired phone may revoke any device: a paired device already runs agents
	// with full access, so this adds no power — and lets one phone cut off a lost one.
	mux.HandleFunc("DELETE /devices/{id}", a.Wrap(func(w http.ResponseWriter, r *http.Request) {
		if !a.cfg.RemoveDevice(r.PathValue("id")) {
			http.Error(w, "no such device", http.StatusNotFound)
		}
	}))
}

func newCode() string {
	b := make([]byte, 8)
	rand.Read(b)
	for i := range b {
		b[i] = codeAlphabet[int(b[i])%len(codeAlphabet)]
	}
	return string(b)
}

func (a *Auth) pairCode(w http.ResponseWriter, r *http.Request) {
	if DeviceID(r) != Admin {
		http.Error(w, "admin only", http.StatusForbidden)
		return
	}
	code, exp := newCode(), time.Now().Add(codeTTL)
	a.mu.Lock()
	for c, t := range a.codes {
		if time.Now().After(t) {
			delete(a.codes, c)
		}
	}
	a.codes[code] = exp
	a.mu.Unlock()
	httpx.WriteJSON(w, map[string]any{"code": code, "expires": exp})
}

// pair: {code, name} → {deviceId, token}. Codes are single use.
func (a *Auth) pair(w http.ResponseWriter, r *http.Request) {
	var req struct{ Code, Name string }
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	a.mu.Lock()
	exp, ok := a.codes[code]
	delete(a.codes, code)
	a.mu.Unlock()
	if !ok || time.Now().After(exp) {
		time.Sleep(500 * time.Millisecond) // slow down guessing
		http.Error(w, "invalid or expired pairing code; run `luther pair` again", http.StatusUnauthorized)
		return
	}
	tok := text.RandHex(32)
	d := config.Device{Device: protocol.Device{ID: text.RandHex(6), Name: text.Clip(text.OrDefault(req.Name, "Phone"), 60), Created: time.Now(), LastSeen: time.Now()}, TokenHash: hashToken(tok)}
	if err := a.cfg.AddDevice(d); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	httpx.WriteJSON(w, map[string]string{"deviceId": d.ID, "token": tok})
}

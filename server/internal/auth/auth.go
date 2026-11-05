// Package auth: every route needs "Authorization: Bearer <token>". Phones get a
// per-device token by trading a one-time pairing code (`luther pair`), sealed to
// this machine's key from the QR; the local CLI uses the admin token from config.
// Both the tailnet proxy and the Cloudflare tunnel arrive from localhost, so
// localhost is never trusted. A phone paired with a key must come through
// Cloudflare end-to-end encrypted (package e2e re-dispatches its requests with an
// internal token); plain requests from it that Cloudflare relayed are refused.
package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
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
	"github.com/AJAmit17/luther/server/internal/seal"
	"github.com/AJAmit17/luther/server/internal/text"
)

const (
	Admin        = "admin" // DeviceID of the local CLI
	codeTTL      = 10 * time.Minute
	codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O/1/I
)

type ctxKey struct{}

type Auth struct {
	cfg      *config.Config
	internal string // this process's secret for re-dispatched (decrypted) requests
	mu       sync.Mutex
	codes    map[string]time.Time
}

func New(cfg *config.Config) *Auth {
	return &Auth{cfg: cfg, internal: text.RandHex(32), codes: map[string]time.Time{}}
}

const internalPrefix = "luther-internal."

// Internal: a bearer token that authenticates as device id, valid only inside
// this process (package e2e uses it after decrypting a device's request).
func (a *Auth) Internal(id string) string { return internalPrefix + a.internal + "." + id }

// Key: the end-to-end key shared with a device.
func (a *Auth) Key(id string) ([]byte, error) { return a.cfg.Shared(id) }

func hashToken(t string) string { s := sha256.Sum256([]byte(t)); return hex.EncodeToString(s[:]) }

// deviceFor: the device id for a token (Admin for the CLI), or "".
func (a *Auth) deviceFor(tok string) (id string, internal bool) {
	if tok == "" {
		return "", false
	}
	if rest, ok := strings.CutPrefix(tok, internalPrefix); ok {
		secret, id, _ := strings.Cut(rest, ".")
		if subtle.ConstantTimeCompare([]byte(secret), []byte(a.internal)) == 1 && id != "" {
			return id, true
		}
		return "", false
	}
	if subtle.ConstantTimeCompare([]byte(tok), []byte(a.cfg.AdminToken)) == 1 {
		return Admin, false
	}
	h := hashToken(tok)
	return a.cfg.FindDevice(func(d config.Device) bool { return subtle.ConstantTimeCompare([]byte(h), []byte(d.TokenHash)) == 1 }), false
}

// Wrap rejects requests without a valid token; DeviceID(r) names the caller.
func (a *Auth) Wrap(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, internal := a.deviceFor(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		if id == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if !internal && id != Admin && r.Header.Get("Cf-Ray") != "" && a.cfg.DevicePub(id) != "" {
			http.Error(w, "this phone talks end-to-end encrypted; plain requests through Cloudflare are refused", http.StatusForbidden)
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

// pair: {pub, box} → {box}. The phone seals {code, name, t} to this machine's
// public key (from the QR) with its own key pub; the answer {deviceId, token} is
// sealed back. A relay sees neither the code nor the token. Codes are single use.
func (a *Auth) pair(w http.ResponseWriter, r *http.Request) {
	var req struct{ Pub, Box string }
	if !httpx.ReadJSON(w, r, &req) {
		return
	}
	key, err := a.cfg.SharedWith(req.Pub)
	box, err2 := base64.StdEncoding.DecodeString(req.Box)
	if err != nil || err2 != nil {
		http.Error(w, "update the Luther app: this Mac needs an encrypted pairing request", http.StatusBadRequest)
		return
	}
	plain, err := seal.Open(key, "pair", box)
	var in struct {
		Code, Name string
		T          int64
	}
	if err != nil || json.Unmarshal(plain, &in) != nil {
		http.Error(w, "this pairing code is for another machine; scan the QR again", http.StatusBadRequest)
		return
	}
	code := strings.ToUpper(strings.TrimSpace(in.Code))
	a.mu.Lock()
	exp, ok := a.codes[code]
	delete(a.codes, code)
	a.mu.Unlock()
	if !ok || time.Now().After(exp) || time.Since(time.UnixMilli(in.T)).Abs() > codeTTL {
		time.Sleep(500 * time.Millisecond) // slow down guessing
		http.Error(w, "invalid or expired pairing code; run `luther pair` again", http.StatusUnauthorized)
		return
	}
	tok := text.RandHex(32)
	d := config.Device{Device: protocol.Device{ID: text.RandHex(6), Name: text.Clip(text.OrDefault(in.Name, "Phone"), 60), Created: time.Now(), LastSeen: time.Now()}, TokenHash: hashToken(tok), Pub: req.Pub}
	if err := a.cfg.AddDevice(d); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	out, _ := json.Marshal(map[string]string{"deviceId": d.ID, "token": tok})
	httpx.WriteJSON(w, map[string]string{"box": base64.StdEncoding.EncodeToString(seal.Box(key, "pair-res", out))})
}

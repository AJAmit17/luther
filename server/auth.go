package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"
)

// Auth: every route needs "Authorization: Bearer <token>". Phones get a
// per-device token by trading a one-time pairing code (`luther pair`); the local
// CLI uses the admin token from ~/.luther/config.json. Both the tailnet proxy and
// the Cloudflare tunnel arrive from localhost, so localhost is never trusted.

type ctxKey struct{}

const (
	codeTTL      = 10 * time.Minute
	codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O/1/I
)

var pairing = struct {
	sync.Mutex
	codes map[string]time.Time
}{codes: map[string]time.Time{}}

func hashToken(t string) string { s := sha256.Sum256([]byte(t)); return hex.EncodeToString(s[:]) }

// deviceFor returns the device id for a token ("admin" for the CLI), or "".
func deviceFor(tok string) string {
	if tok == "" {
		return ""
	}
	cfgMu.Lock()
	defer cfgMu.Unlock()
	if subtle.ConstantTimeCompare([]byte(tok), []byte(cfg.AdminToken)) == 1 {
		return "admin"
	}
	h := hashToken(tok)
	for _, d := range cfg.Devices {
		if subtle.ConstantTimeCompare([]byte(h), []byte(d.TokenHash)) == 1 {
			return d.ID
		}
	}
	return ""
}

func (s *server) auth(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := deviceFor(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		if id == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if id != "admin" {
			touchDevice(id)
		}
		h(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, id)))
	}
}

func deviceID(r *http.Request) string { id, _ := r.Context().Value(ctxKey{}).(string); return id }

func newCode() string {
	b := make([]byte, 8)
	rand.Read(b)
	for i := range b {
		b[i] = codeAlphabet[int(b[i])%len(codeAlphabet)]
	}
	return string(b)
}

// pairCode: POST /pair/code (admin only) → a one-time code for the QR.
func (s *server) pairCode(w http.ResponseWriter, r *http.Request) {
	if deviceID(r) != "admin" {
		http.Error(w, "admin only", http.StatusForbidden)
		return
	}
	code := newCode()
	exp := time.Now().Add(codeTTL)
	pairing.Lock()
	for c, t := range pairing.codes {
		if time.Now().After(t) {
			delete(pairing.codes, c)
		}
	}
	pairing.codes[code] = exp
	pairing.Unlock()
	writeJSON(w, map[string]any{"code": code, "expires": exp})
}

// pair: POST /pair {code, name} (no auth) → {deviceId, token}. Codes are single use.
func (s *server) pair(w http.ResponseWriter, r *http.Request) {
	var req struct{ Code, Name string }
	if !readJSON(w, r, &req) {
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	pairing.Lock()
	exp, ok := pairing.codes[code]
	delete(pairing.codes, code)
	pairing.Unlock()
	if !ok || time.Now().After(exp) {
		time.Sleep(500 * time.Millisecond) // slow down guessing
		http.Error(w, "invalid or expired pairing code; run `luther pair` again", http.StatusUnauthorized)
		return
	}
	tok := randHex(32)
	d := deviceRec{Device: Device{ID: randHex(6), Name: clip(orDefault(req.Name, "Phone"), 60), Created: time.Now(), LastSeen: time.Now()}, TokenHash: hashToken(tok)}
	cfgMu.Lock()
	cfg.Devices = append(cfg.Devices, d)
	err := cfg.save()
	cfgMu.Unlock()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"deviceId": d.ID, "token": tok})
}

func (s *server) listDevices(w http.ResponseWriter, r *http.Request) {
	cfgMu.Lock()
	out := []Device{}
	for _, d := range cfg.Devices {
		out = append(out, d.Device)
	}
	cfgMu.Unlock()
	writeJSON(w, out)
}

func (s *server) revokeDevice(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	cfgMu.Lock()
	defer cfgMu.Unlock()
	n := len(cfg.Devices)
	cfg.Devices = slices.DeleteFunc(cfg.Devices, func(d deviceRec) bool { return d.ID == id })
	if len(cfg.Devices) == n {
		http.Error(w, "no such device", http.StatusNotFound)
		return
	}
	cfg.save()
}

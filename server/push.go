package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

// Push: the hub sees every prompt and turn end, so it notifies paired phones
// itself through Expo's push service. Each device stores its own Expo token.

var pushURL = "https://exp.host/--/api/v2/push/send"

// setPush: POST /devices/push {token} — the calling device registers its Expo push token.
func (s *server) setPush(w http.ResponseWriter, r *http.Request) {
	var req struct{ Token string }
	if !readJSON(w, r, &req) {
		return
	}
	if !strings.HasPrefix(req.Token, "ExponentPushToken[") {
		http.Error(w, "token must be an Expo push token", http.StatusBadRequest)
		return
	}
	id := deviceID(r)
	cfgMu.Lock()
	defer cfgMu.Unlock()
	for i := range cfg.Devices {
		if cfg.Devices[i].ID == id && cfg.Devices[i].PushToken != req.Token {
			cfg.Devices[i].PushToken = req.Token
			cfg.save()
		}
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// notify sends to every device with a push token, in the background.
func notify(title, body string, data map[string]string) {
	cfgMu.Lock()
	var to []string
	for _, d := range cfg.Devices {
		if d.PushToken != "" {
			to = append(to, d.PushToken)
		}
	}
	cfgMu.Unlock()
	if len(to) == 0 {
		return
	}
	go func() {
		msgs := make([]map[string]any, len(to))
		for i, t := range to {
			msgs[i] = map[string]any{"to": t, "title": title, "body": clip(strings.TrimSpace(body), 180), "data": data, "sound": "default", "priority": "high"}
		}
		b, _ := json.Marshal(msgs)
		res, err := (&http.Client{Timeout: 15 * time.Second}).Post(pushURL, "application/json", bytes.NewReader(b))
		if err != nil {
			log.Printf("push: %v", err)
			return
		}
		defer res.Body.Close()
		var out struct {
			Data []struct {
				Status, Message string
				Details         struct{ Error string }
			}
		}
		json.NewDecoder(res.Body).Decode(&out)
		for i, t := range out.Data {
			if t.Status == "error" && i < len(to) {
				log.Printf("push: %s", t.Message)
				if t.Details.Error == "DeviceNotRegistered" {
					dropPushToken(to[i])
				}
			}
		}
	}()
}

// dropPushToken forgets a token Expo says is dead (app uninstalled).
func dropPushToken(tok string) {
	cfgMu.Lock()
	defer cfgMu.Unlock()
	for i := range cfg.Devices {
		if cfg.Devices[i].PushToken == tok {
			cfg.Devices[i].PushToken = ""
		}
	}
	cfg.save()
}

func providerName(p Provider) string {
	switch p {
	case Claude:
		return "Claude"
	case Codex:
		return "Codex"
	}
	return string(p)
}

func baseName(p string) string { return filepath.Base(p) }

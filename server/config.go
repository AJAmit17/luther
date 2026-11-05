package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// ~/.luther/config.json (0600): port, routes, the CLI's admin token, paired devices.
// Conversation history is never stored here — it lives in each CLI's own store.

type Config struct {
	Port       int         `json:"port"`
	Name       string      `json:"name,omitempty"`    // shown on the phone; default hostname
	Tailnet    string      `json:"tailnet,omitempty"` // https://mac.tailnet.ts.net[:port]
	Tunnel     string      `json:"tunnel,omitempty"`  // https://luther.example.com
	AdminToken string      `json:"adminToken"`        // for the local CLI (pair, doctor)
	Devices    []deviceRec `json:"devices,omitempty"`
}

type deviceRec struct {
	Device
	TokenHash string `json:"tokenHash"`
	PushToken string `json:"pushToken,omitempty"`
}

const defaultPort = 47900

var (
	cfgMu sync.Mutex
	cfg   *Config
)

func lutherDir() string { return filepath.Join(home, ".luther") }

func configPath() string { return filepath.Join(lutherDir(), "config.json") }

// loadConfig reads (or creates) the config; one per process.
func loadConfig() (*Config, error) {
	c := &Config{Port: defaultPort}
	b, err := os.ReadFile(configPath())
	if err == nil {
		if err := json.Unmarshal(b, c); err != nil {
			return nil, err
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if c.Name == "" {
		c.Name, _ = os.Hostname()
	}
	if c.AdminToken == "" {
		c.AdminToken = randHex(32)
		if err := c.save(); err != nil {
			return nil, err
		}
	}
	return c, nil
}

// save: callers hold cfgMu (or own c exclusively).
func (c *Config) save() error {
	if err := os.MkdirAll(lutherDir(), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	tmp := configPath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, configPath())
}

func (c *Config) routes() []string {
	var out []string
	for _, u := range []string{c.Tailnet, c.Tunnel} {
		if u != "" {
			out = append(out, u)
		}
	}
	return out
}

func touchDevice(id string) {
	cfgMu.Lock()
	defer cfgMu.Unlock()
	for i := range cfg.Devices {
		if cfg.Devices[i].ID == id {
			cfg.Devices[i].LastSeen = time.Now()
		}
	}
}

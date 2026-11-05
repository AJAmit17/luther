// Package config: ~/.luther/config.json (0600) — port, routes, the CLI's admin
// token and paired devices. Conversation history never lives here; it stays in
// each CLI's own store. Safe for concurrent use.
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
)

const DefaultPort = 47900

type Config struct {
	mu         sync.Mutex
	Port       int      `json:"port"`
	Name       string   `json:"name,omitempty"`    // shown on the phone; default hostname
	Tailnet    string   `json:"tailnet,omitempty"` // https://mac.tailnet.ts.net[:port]
	Tunnel     string   `json:"tunnel,omitempty"`  // https://luther.example.com
	AdminToken string   `json:"adminToken"`        // for the local CLI (pair, doctor)
	Devices    []Device `json:"devices,omitempty"`
}

// Device: a paired phone; only the hash of its token is kept.
type Device struct {
	protocol.Device
	TokenHash string `json:"tokenHash"`
}

func Dir() string { return filepath.Join(paths.Home, ".luther") }

func path() string { return filepath.Join(Dir(), "config.json") }

// Load reads (or creates) the config.
func Load() (*Config, error) {
	c := &Config{Port: DefaultPort}
	b, err := os.ReadFile(path())
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
		c.AdminToken = text.RandHex(32)
		if err := c.Save(); err != nil {
			return nil, err
		}
	}
	return c, nil
}

func (c *Config) Save() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.saveLocked()
}

func (c *Config) saveLocked() error {
	if err := os.MkdirAll(Dir(), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	tmp := path() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path())
}

// Routes: the URLs a phone can reach this Mac at, in preference order.
func (c *Config) Routes() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []string
	for _, u := range []string{c.Tailnet, c.Tunnel} {
		if u != "" {
			out = append(out, u)
		}
	}
	return out
}

func (c *Config) DisplayName() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.Name
}

// FindDevice: the device whose token hashes to h, or "".
func (c *Config) FindDevice(match func(Device) bool) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, d := range c.Devices {
		if match(d) {
			return d.ID
		}
	}
	return ""
}

func (c *Config) ListDevices() []protocol.Device {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := []protocol.Device{}
	for _, d := range c.Devices {
		out = append(out, d.Device)
	}
	return out
}

func (c *Config) AddDevice(d Device) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Devices = append(c.Devices, d)
	return c.saveLocked()
}

// RemoveDevice reports whether the device existed.
func (c *Config) RemoveDevice(id string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := len(c.Devices)
	c.Devices = slices.DeleteFunc(c.Devices, func(d Device) bool { return d.ID == id })
	if len(c.Devices) == n {
		return false
	}
	c.saveLocked()
	return true
}

// Touch records that a device was just seen (in memory; saved with the next change).
func (c *Config) Touch(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := range c.Devices {
		if c.Devices[i].ID == id {
			c.Devices[i].LastSeen = time.Now()
		}
	}
}

// Set changes fields under the lock and saves.
func (c *Config) Set(fn func(c *Config)) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	fn(c)
	return c.saveLocked()
}

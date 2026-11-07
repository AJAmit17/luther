// Package config: ~/.luther/config.json (0600) — port, routes, the CLI's admin
// token and paired devices. Conversation history never lives here; it stays in
// each CLI's own store. Safe for concurrent use.
package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/seal"
	"github.com/AJAmit17/luther/server/internal/text"
	"github.com/AJAmit17/luther/server/internal/tunnel"
)

const DefaultPort = 47900

type Config struct {
	mu         sync.Mutex
	Port       int      `json:"port"`
	Name       string   `json:"name,omitempty"`    // shown on the phone; default hostname
	Tailnet    string   `json:"tailnet,omitempty"` // https://mac.tailnet.ts.net[:port]
	Funnel     bool     `json:"funnel,omitempty"`  // Tailnet is published with Funnel (public), not Serve
	Tunnel     string   `json:"tunnel,omitempty"`  // https://luther.example.com (a named Cloudflare tunnel; a quick one is in quick.json)
	AdminToken string   `json:"adminToken"`        // for the local CLI (pair, doctor)
	SecretKey  string   `json:"secretKey"`         // X25519, for end-to-end encryption with phones
	Devices    []Device `json:"devices,omitempty"`
}

// Device: a paired phone; only the hash of its token is kept.
type Device struct {
	protocol.Device
	TokenHash string `json:"tokenHash"`
	Pub       string `json:"pub,omitempty"` // its X25519 key: it talks end-to-end encrypted
}

func Dir() string { return filepath.Join(paths.Home, ".luther") }

func path() string { return filepath.Join(Dir(), "config.json") }

// Load reads (or creates) the config.
func Load() (*Config, error) {
	c, err := Read()
	if err != nil {
		return nil, err
	}
	if c.AdminToken == "" || c.SecretKey == "" {
		if c.AdminToken == "" {
			c.AdminToken = text.RandHex(32)
		}
		if c.SecretKey == "" {
			c.SecretKey = seal.NewKey()
		}
		if err := c.Save(); err != nil {
			return nil, err
		}
	}
	return c, nil
}

func Read() (*Config, error) {
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
	for _, u := range []string{c.Tailnet, c.Tunnel, tunnel.QuickURL()} {
		if u != "" {
			out = append(out, u)
		}
	}
	return out
}

// PublicKey: this machine's X25519 key, base64 (it goes in the pairing QR).
func (c *Config) PublicKey() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	pub, _ := seal.Public(c.SecretKey)
	return pub
}

// DevicePub: a device's public key ("" for one paired before encryption).
func (c *Config) DevicePub(id string) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, d := range c.Devices {
		if d.ID == id {
			return d.Pub
		}
	}
	return ""
}

func (c *Config) secret() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.SecretKey
}

// Shared: the end-to-end key with device id, or an error if it has none.
func (c *Config) Shared(id string) ([]byte, error) {
	pub := c.DevicePub(id)
	if pub == "" {
		return nil, errNoKey
	}
	return seal.Shared(c.secret(), pub)
}

// SharedWith: the key with a phone's public key (pairing, before it's a device).
func (c *Config) SharedWith(pub string) ([]byte, error) { return seal.Shared(c.secret(), pub) }

var errNoKey = errors.New("this device was paired without end-to-end encryption; pair it again")

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
		dd := d.Device
		dd.Encrypted = d.Pub != ""
		out = append(out, dd)
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

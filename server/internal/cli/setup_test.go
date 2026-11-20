package cli

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/paths"
)

// A configured route that answers is kept: setup adds no tunnel.
func TestSetupKeepsAnsweringRoute(t *testing.T) {
	paths.Home = t.TempDir()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			w.Write([]byte(`{"ok":true}`))
		}
	}))
	defer ts.Close()
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	cfg.Set(func(c *config.Config) { c.Tunnel = ts.URL })
	c := New(cfg)
	var out bytes.Buffer
	c.out, c.view = &out, newPresentation(&out, true)
	if u, err := c.ensureRoute(); err != nil || u != ts.URL {
		t.Fatalf("route %q, err %v", u, err)
	}
}

// No agent CLI on PATH: setup stops before starting anything.
func TestSetupNeedsAnAgent(t *testing.T) {
	paths.Home = t.TempDir()
	t.Setenv("PATH", t.TempDir())
	t.Setenv("SHELL", "/nonexistent")
	if _, _, err := invoke(t, "setup"); err == nil {
		t.Fatal("setup ran without an agent")
	}
}

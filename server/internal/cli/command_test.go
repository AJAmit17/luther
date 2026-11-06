package cli

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/remote"
)

func invoke(t *testing.T, args ...string) (string, string, error) {
	t.Helper()
	var out, errOut bytes.Buffer
	err := Execute(args, &out, &errOut, func(*config.Config) { t.Fatal("unexpected server start") })
	return out.String(), errOut.String(), err
}

func TestInformationalCommandsDoNotCreateConfig(t *testing.T) {
	paths.Home = t.TempDir()
	for _, args := range [][]string{
		{}, {"--help"}, {"start", "--help"}, {"pair", "--help"}, {"tailscale", "--help"},
		{"tunnel", "--help"}, {"service"}, {"service", "--help"}, {"service", "install", "--help"},
		{"remote"}, {"remote", "--help"}, {"remote", "add", "--help"}, {"doctor", "--help"},
		{"version"}, {"--version"}, {"-v"}, {"completion", "zsh"}, {"completion", "bash"},
		{"completion", "fish"}, {"completion", "powershell"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			out, errOut, err := invoke(t, args...)
			if err != nil || out == "" || errOut != "" {
				t.Fatalf("out=%q stderr=%q err=%v", out, errOut, err)
			}
			if strings.Contains(out, "\x1b[") {
				t.Fatal("ANSI escapes in piped output")
			}
			if _, err := os.Stat(config.Dir()); !os.IsNotExist(err) {
				t.Fatalf("informational command created config: %v", err)
			}
		})
	}
}

func TestCommandValidationBeforeConfig(t *testing.T) {
	paths.Home = t.TempDir()
	for _, args := range [][]string{
		{"start", "extra"}, {"stop", "--unknown"}, {"pair", "extra"},
		{"tailscale", "--https", "0"}, {"tailscale", "--https", "65536"},
		{"service", "install", "extra"}, {"service", "invalid"}, {"remote", "invalid"}, {"remote", "add", "name"},
		{"remote", "add", "name", "user@host", "--port", "-1"},
		{"remote", "remove"}, {"doctor", "extra"}, {"completion", "invalid"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			_, errOut, err := invoke(t, args...)
			if err == nil || !strings.Contains(errOut, "Error:") {
				t.Fatalf("expected a useful validation error: %q, %v", errOut, err)
			}
			if _, err := os.Stat(config.Dir()); !os.IsNotExist(err) {
				t.Fatal("validation created config")
			}
		})
	}
	_, errOut, err := invoke(t, "strat")
	if err == nil || !strings.Contains(errOut, "start") {
		t.Fatalf("missing typo suggestion: %q", errOut)
	}
}

func TestVersionCompatibility(t *testing.T) {
	paths.Home = t.TempDir()
	for _, args := range [][]string{{"version"}, {"--version"}, {"-v"}} {
		out, _, err := invoke(t, args...)
		if err != nil || out != "luther "+protocol.Version+"\n" {
			t.Fatalf("%v: %q, %v", args, out, err)
		}
	}
}

func testConfig(t *testing.T, handler http.Handler) *config.Config {
	t.Helper()
	paths.Home = t.TempDir()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	_, port, _ := net.SplitHostPort(server.Listener.Addr().String())
	p, _ := strconv.Atoi(port)
	cfg := &config.Config{Port: p, Name: "Test Mac", Tailnet: "https://test.invalid", AdminToken: "test-admin", SecretKey: "test-key"}
	if err := cfg.Save(); err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestPairJSONRemainsUndecorated(t *testing.T) {
	testConfig(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/pair/code" || r.Header.Get("Authorization") != "Bearer test-admin" {
			t.Error("incorrect pairing request")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"code":"test-code","expires":"2026-11-06T12:00:00Z"}`))
	}))
	out, errOut, err := invoke(t, "pair", "--json")
	var payload map[string]any
	if err != nil || errOut != "" || json.Unmarshal([]byte(out), &payload) != nil || payload["code"] != "test-code" {
		t.Fatalf("pair JSON was decorated or changed: err=%v stderr=%q", err, errOut)
	}
}

func TestStatusJSONContainsNoCredentials(t *testing.T) {
	testConfig(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"ok":true,"name":"Test Mac","version":"test-build"}`))
	}))
	out, _, err := invoke(t, "status", "--json")
	var status map[string]any
	if err != nil || json.Unmarshal([]byte(out), &status) != nil || status["running"] != true || status["version"] != "test-build" {
		t.Fatalf("status JSON: %q, %v", out, err)
	}
	if strings.Contains(out, "test-admin") || strings.Contains(out, "test-key") {
		t.Fatal("status exposed credentials")
	}
}

func TestNoColorAndMissingConfig(t *testing.T) {
	paths.Home = t.TempDir()
	t.Setenv("NO_COLOR", "1")
	for _, args := range [][]string{{"--help"}, {"status"}, {"--no-color", "status"}} {
		out, _, err := invoke(t, args...)
		if err != nil || strings.Contains(out, "\x1b") {
			t.Fatalf("plain output: %q, %v", out, err)
		}
	}
	if _, err := os.Stat(filepath.Join(paths.Home, ".luther")); !os.IsNotExist(err) {
		t.Fatal("status created configuration")
	}
}

func fakeTool(t *testing.T, name, body string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, name), []byte("#!/bin/sh\n"+body), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func TestCobraTailscaleFlagsReachHandler(t *testing.T) {
	paths.Home = t.TempDir()
	calls := filepath.Join(paths.Home, "calls")
	t.Setenv("LUTHER_TEST_CALLS", calls)
	fakeTool(t, "tailscale", `case "$*" in
  "status --json") printf '{"Self":{"DNSName":"mac.test.invalid."}}';;
  "serve status --json") printf '{"Web":{}}';;
  *) printf '%s\n' "$*" >> "$LUTHER_TEST_CALLS";;
esac
`)
	_, _, err := invoke(t, "tailscale", "--https", "8443", "--force")
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(calls)
	if err != nil || !strings.Contains(string(got), "serve --bg --https=8443 http://127.0.0.1:47900") {
		t.Fatalf("flags weren't forwarded: %q, %v", got, err)
	}
	cfg, err := config.Read()
	if err != nil || cfg.Tailnet != "https://mac.test.invalid:8443" {
		t.Fatalf("route wasn't saved correctly: %v", err)
	}
}

func TestCobraRemoteFlagsBeforeAndAfterArguments(t *testing.T) {
	for _, args := range [][]string{
		{"remote", "add", "--port", "48001", "--ssh", "-p 2222", "devbox", "user@devbox"},
		{"remote", "add", "devbox", "user@devbox", "--port", "48001", "--ssh", "-p 2222"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			testConfig(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("{}")) }))
			fakeTool(t, "ssh", "printf 'fixture\\n'\n")
			_, errOut, err := invoke(t, args...)
			if err != nil {
				t.Fatalf("remote add: %v %s", err, errOut)
			}
			rs, err := remote.Load()
			if err != nil || len(rs) != 1 || rs[0].Port != 48001 || rs[0].SSHArg != "-p 2222" || rs[0].Target != "user@devbox" {
				t.Fatalf("remote flags lost: %+v, %v", rs, err)
			}
		})
	}
}

func TestServeIsExplicitAndLoadsOnlyTemporaryConfig(t *testing.T) {
	paths.Home = t.TempDir()
	var out, errOut bytes.Buffer
	called := false
	err := Execute([]string{"serve"}, &out, &errOut, func(cfg *config.Config) {
		called = true
		if cfg.AdminToken == "" || cfg.SecretKey == "" {
			t.Fatal("serve did not initialize its configuration")
		}
	})
	if err != nil || !called || out.Len() != 0 || errOut.Len() != 0 {
		t.Fatalf("serve dispatch: called=%v err=%v out=%q stderr=%q", called, err, out.String(), errOut.String())
	}
}

func TestHelpAndVersionIgnoreMalformedConfig(t *testing.T) {
	paths.Home = t.TempDir()
	os.MkdirAll(config.Dir(), 0o700)
	os.WriteFile(filepath.Join(config.Dir(), "config.json"), []byte("{broken"), 0o600)
	for _, args := range [][]string{{"--help"}, {"pair", "--help"}, {"version"}, {"completion", "zsh"}} {
		if _, _, err := invoke(t, args...); err != nil {
			t.Fatalf("%v tried to load config: %v", args, err)
		}
	}
}

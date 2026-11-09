package claudeaccounts

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/AJAmit17/luther/server/internal/paths"
)

func TestAccounts(t *testing.T) {
	paths.Home = t.TempDir()
	if a, env := Env(); a != "" || env != nil {
		t.Fatalf("no account chosen: the CLI's login, no env; got %q %v", a, env)
	}
	if Add("Terminal", "tok") == nil || Add("x", "two words") == nil {
		t.Fatal("Terminal is reserved; a token has no spaces")
	}
	if err := Add("Desktop app", " sk-ant-oat01-abc\n"); err != nil {
		t.Fatal(err)
	}
	if a, _ := Env(); a != "" {
		t.Fatal("adding doesn't switch")
	}
	if err := Use("Desktop app"); err != nil {
		t.Fatal(err)
	}
	if a, env := Env(); a != "Desktop app" || len(env) != 1 || env[0] != "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-abc" {
		t.Fatalf("got %q %v", a, env)
	}

	// Only Luther's own file, private; nothing under ~/.claude.
	entries, _ := os.ReadDir(paths.Home)
	if len(entries) != 1 || entries[0].Name() != ".luther" {
		t.Fatalf("wrote outside ~/.luther: %v", entries)
	}
	if st, _ := os.Stat(filepath.Join(paths.Home, ".luther", "claude-accounts.json")); st.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", st.Mode())
	}

	// The phone sees names, never tokens.
	mux := http.NewServeMux()
	Routes(mux, func(h http.HandlerFunc) http.HandlerFunc { return h })
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/claude-accounts", nil))
	if body := rec.Body.String(); strings.Contains(body, "sk-ant") || !strings.Contains(body, `"active":"Desktop app"`) {
		t.Fatalf("GET /claude-accounts: %s", body)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("PUT", "/claude-accounts/active", strings.NewReader(`{"name":"Terminal"}`)))
	if a, _ := Env(); rec.Code != 200 || a != "" {
		t.Fatalf("back to the CLI's login: %d %q", rec.Code, a)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("PUT", "/claude-accounts/active", strings.NewReader(`{"name":"nope"}`)))
	if rec.Code != 400 {
		t.Fatalf("unknown account: %d", rec.Code)
	}

	Use("Desktop app")
	if err := Remove("Desktop app"); err != nil {
		t.Fatal(err)
	}
	if a, env := Env(); a != "" || env != nil {
		t.Fatal("removing the one in use falls back to the CLI's login")
	}
}

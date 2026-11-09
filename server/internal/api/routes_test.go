package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/paths"
)

// Every route registers without a pattern conflict, and the new ones answer.
func TestHandlerRoutes(t *testing.T) {
	paths.Home = t.TempDir()
	h := Handler(&config.Config{Port: config.DefaultPort})
	for _, c := range []struct {
		method, path string
		want         int
	}{
		{"GET", "/agent-tools", http.StatusUnauthorized},
		{"POST", "/agent-tools/show_artifact", http.StatusUnauthorized},
		{"GET", "/templates", http.StatusUnauthorized},
		{"POST", "/walkthroughs", http.StatusUnauthorized},
		{"POST", "/artifacts/art-x/link", http.StatusUnauthorized},
		{"GET", "/a/nope/", http.StatusGone},
		{"GET", "/compares", http.StatusUnauthorized},
		{"POST", "/compares/x/keep", http.StatusUnauthorized},
		{"POST", "/schedules/x/read", http.StatusUnauthorized},
	} {
		req := httptest.NewRequest(c.method, c.path, nil)
		req.RemoteAddr = "127.0.0.1:1"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s %s: %d, want %d", c.method, c.path, rec.Code, c.want)
		}
	}
}

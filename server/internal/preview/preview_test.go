package preview

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// A preview link opens once, swaps itself for a cookie of its own, and never
// redirects off the site.
func TestLinkOnce(t *testing.T) {
	mux := http.NewServeMux()
	Routes(mux, func(h http.HandlerFunc) http.HandlerFunc { return h }, 1)
	grants.Lock()
	grants.m["abc"] = grant{4000, time.Now().Add(ttl)}
	grants.Unlock()

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/p/abc/%5Cevil.com", nil))
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/evil.com" {
		t.Fatalf("first open: %d %q", rec.Code, rec.Header().Get("Location"))
	}
	c := rec.Result().Cookies()
	if len(c) != 1 || c[0].Value == "abc" {
		t.Fatalf("cookie must be a new secret, got %+v", c)
	}
	if port, ok := lookup(c[0].Value); !ok || port != 4000 {
		t.Fatal("cookie not bound to the port")
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/p/abc/", nil))
	if rec.Code != http.StatusGone {
		t.Fatalf("second open: %d", rec.Code)
	}
}

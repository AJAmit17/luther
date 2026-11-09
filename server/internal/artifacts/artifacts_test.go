package artifacts

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/AJAmit17/luther/server/internal/paths"
)

func TestLinkAndServe(t *testing.T) {
	paths.Home = t.TempDir()
	proj := filepath.Join(paths.Home, "proj")
	os.MkdirAll(proj, 0o755)
	page := filepath.Join(proj, "page.html")
	os.WriteFile(page, []byte("<p>one</p>"), 0o644)
	id, err := Save(proj, "Page", "page.html", "")
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	Routes(mux, func(h http.HandlerFunc) http.HandlerFunc { return h })

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/artifacts/"+id+"/link", nil))
	var link struct{ Path string }
	json.Unmarshal(rec.Body.Bytes(), &link)
	if rec.Code != 200 || link.Path == "" {
		t.Fatalf("link: %d %s", rec.Code, rec.Body)
	}
	get := func() *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("GET", link.Path, nil))
		return rec
	}
	r := get()
	if r.Code != 200 || r.Body.String() != "<p>one</p>" || r.Header().Get("Content-Security-Policy") != "sandbox allow-scripts" {
		t.Fatalf("serve: %d %q %v", r.Code, r.Body, r.Header())
	}
	// The agent edits the file: a reload shows the new version.
	os.WriteFile(page, []byte("<p>two</p>"), 0o644)
	if r := get(); r.Body.String() != "<p>two</p>" {
		t.Fatalf("reload: %q", r.Body)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/artifacts/art-nope/link", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown id: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/a/nope/", nil))
	if rec.Code != http.StatusGone {
		t.Fatalf("unknown link: %d", rec.Code)
	}

	// Inline pages are kept by Luther, and the same arguments give the same id.
	id2, err := Save(proj, "Inline", "", "<b>x</b>")
	if err != nil || id2 != ID("Inline", "", "<b>x</b>") {
		t.Fatalf("inline: %v %s", err, id2)
	}
	if b, _ := os.ReadFile(filepath.Join(Dir(), id2+".html")); string(b) != "<b>x</b>" {
		t.Fatalf("inline file: %q", b)
	}
}

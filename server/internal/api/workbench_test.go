package api

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/paths"
)

func TestShellAndLogs(t *testing.T) {
	paths.Home = t.TempDir()
	proj := filepath.Join(paths.Home, "proj")
	os.MkdirAll(proj, 0o755)
	b, _ := json.Marshal(map[string]string{"cwd": proj, "command": "echo hi; pwd; exit 3"})
	rec := httptest.NewRecorder()
	runShell(rec, httptest.NewRequest("POST", "/shell", bytes.NewReader(b)))
	var out struct {
		Output string
		Code   int
	}
	json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != 200 || out.Code != 3 || !strings.Contains(out.Output, "hi") || !strings.Contains(out.Output, "proj") {
		t.Fatalf("shell: %d %+v", rec.Code, out)
	}
	b, _ = json.Marshal(map[string]string{"cwd": "/etc", "command": "ls"})
	rec = httptest.NewRecorder()
	runShell(rec, httptest.NewRequest("POST", "/shell", bytes.NewReader(b)))
	if rec.Code != 400 {
		t.Fatalf("shell outside home: %d", rec.Code)
	}

	os.MkdirAll(config.Dir(), 0o700)
	var log strings.Builder
	for i := 0; i < 50; i++ {
		log.WriteString("line\n")
	}
	log.WriteString("last")
	os.WriteFile(filepath.Join(config.Dir(), "serve.log"), []byte(log.String()), 0o600)
	rec = httptest.NewRecorder()
	logs(rec, httptest.NewRequest("GET", "/logs?lines=3", nil))
	if got := rec.Body.String(); got != "line\nline\nlast" {
		t.Fatalf("logs: %q", got)
	}
}

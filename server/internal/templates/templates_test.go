package templates

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/AJAmit17/luther/server/internal/paths"
)

func TestList(t *testing.T) {
	paths.Home = t.TempDir()
	if err := os.MkdirAll(Dir(), 0o700); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"tester.md":   "---\ndescription: Writes tests\nagent: codex\nmode: edits\nmodel: gpt-6-luna\n---\nWrite tests for the change.\n",
		"reviewer.md": "Mine replaces the built-in.",
		"Bad Name.md": "ignored",
		"empty.md":    "---\ndescription: nothing\n---\n",
		"wild.md":     "---\nmode: yolo\n---\nKeep going.",
	}
	for name, body := range files {
		os.WriteFile(filepath.Join(Dir(), name), []byte(body), 0o600)
	}
	got := map[string]bool{}
	for _, tp := range List() {
		got[tp.Name] = true
	}
	if len(got) != 3 || !got["tester"] || !got["reviewer"] || !got["wild"] {
		t.Fatalf("names: %v", got)
	}
	tp, _ := Get("tester")
	if tp.Provider != "codex" || tp.Mode != "edits" || tp.Model != "gpt-6-luna" || tp.Description != "Writes tests" || tp.Instructions != "Write tests for the change." {
		t.Fatalf("tester: %+v", tp)
	}
	if r, _ := Get("reviewer"); r.BuiltIn || r.Instructions != "Mine replaces the built-in." {
		t.Fatalf("reviewer: %+v", r)
	}
	if w, _ := Get("wild"); w.Mode != "" {
		t.Fatalf("bad mode kept: %+v", w)
	}
}

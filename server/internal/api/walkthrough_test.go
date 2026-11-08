package api

import (
	"strings"
	"testing"
)

func TestCleanDiff(t *testing.T) {
	diff := "diff --git a/main.go b/main.go\n+code\n" +
		"diff --git a/package-lock.json b/package-lock.json\n+lock\n" +
		"diff --git a/web/app.min.js b/web/app.min.js\n+min\n" +
		"diff --git a/README.md b/README.md\n+docs"
	got := clean(diff)
	if !strings.Contains(got, "+code") || !strings.Contains(got, "+docs") || strings.Contains(got, "+lock") || strings.Contains(got, "+min") {
		t.Fatalf("clean:\n%s", got)
	}
	if !strings.HasPrefix(got, "diff --git a/main.go") || !strings.Contains(got, "\ndiff --git a/README.md b/README.md\n") {
		t.Fatalf("headers lost:\n%s", got)
	}
}

func TestModeRank(t *testing.T) {
	// A thread an agent starts never gets more access than the agent's own.
	order := []string{"plan", "ask", "edits", "full"}
	for i := 1; i < len(order); i++ {
		if modeRank[order[i]] <= modeRank[order[i-1]] {
			t.Fatalf("%s should rank above %s", order[i], order[i-1])
		}
	}
}

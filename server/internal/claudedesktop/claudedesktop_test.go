package claudedesktop

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/usage"
)

func write(t *testing.T, rel, body string) {
	t.Helper()
	p := filepath.Join(paths.Home, rel)
	os.MkdirAll(filepath.Dir(p), 0o700)
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

const history = `{"version":2,"samples":[
 {"t":2000,"org":"desk","u":{"fh":44,"sd":14}},
 {"t":1000,"org":"desk","u":{"fh":0,"sd":4}}]}`

// One test: usage keeps its store in memory for the process.
func TestDesktopAccountShownApart(t *testing.T) {
	paths.Home = t.TempDir()
	if err := ReadLimits(); err != nil { // no desktop app: nothing, no error
		t.Fatal(err)
	}
	write(t, "Library/Application Support/Claude/plan-usage-history.json", history)
	write(t, ".claude.json", `{"oauthAccount":{"organizationUuid":"desk"}}`)
	if err := ReadLimits(); err != nil {
		t.Fatal(err)
	}
	if n := len(usage.All()); n != 0 {
		t.Fatalf("same organization as the CLI shown again: %+v", usage.All())
	}

	write(t, ".claude.json", `{"oauthAccount":{"organizationUuid":"cli"}}`)
	usage.Set(protocol.Limits{Provider: protocol.Claude, Windows: []protocol.Window{{Label: "5 hours", Used: 80}}})
	if err := ReadLimits(); err != nil {
		t.Fatal(err)
	}
	all := usage.All()
	if len(all) != 2 || all[0].Account != "" || all[1].Account != Account {
		t.Fatalf("want the CLI login then the desktop app, got %+v", all)
	}
	d := all[1]
	if d.Updated != 2000 || len(d.Windows) != 2 || d.Windows[0].Used != 44 || d.Windows[1].Label != "7 days" {
		t.Fatalf("newest sample, dated when taken: %+v", d)
	}
}

// Package claudeaccounts: other Claude accounts Luther's threads can run under,
// next to the claude CLI's own login. Each is a long-lived token you made with
// `claude setup-token` and gave Luther (`luther claude-account add`). Kept in
// ~/.luther/claude-accounts.json (0600), never shown to a phone, and passed
// only as CLAUDE_CODE_OAUTH_TOKEN in the environment of a claude Luther
// starts. The CLI's login (its Keychain entry, ~/.claude) is never touched:
// with no account chosen, claude runs as the CLI is signed in.
package claudeaccounts

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/httpx"
)

// Terminal names the claude CLI's own login: no token of Luther's.
const Terminal = "Terminal"

type file struct {
	Active string            `json:"active,omitempty"` // "" = the CLI's login
	Tokens map[string]string `json:"tokens"`
}

var mu sync.Mutex

func path() string { return filepath.Join(config.Dir(), "claude-accounts.json") }

// read: the file fresh each time, so `luther claude-account` takes effect on a
// running server. mu held.
func read() file {
	f := file{Tokens: map[string]string{}}
	if b, err := os.ReadFile(path()); err == nil {
		json.Unmarshal(b, &f)
	}
	if f.Tokens == nil {
		f.Tokens = map[string]string{}
	}
	if _, ok := f.Tokens[f.Active]; !ok {
		f.Active = "" // removed meanwhile
	}
	return f
}

func write(f file) error {
	b, _ := json.MarshalIndent(f, "", "  ")
	if err := os.MkdirAll(config.Dir(), 0o700); err != nil {
		return err
	}
	tmp := path() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path())
}

// Add stores (or replaces) name's token.
func Add(name, token string) error {
	name, token = strings.TrimSpace(name), strings.TrimSpace(token)
	switch {
	case name == "" || strings.EqualFold(name, Terminal):
		return errors.New("choose another name: " + Terminal + " is the claude CLI's own login")
	case token == "" || strings.ContainsAny(token, " \t\r\n"):
		return errors.New("that isn't a token: paste the one `claude setup-token` printed")
	}
	mu.Lock()
	defer mu.Unlock()
	f := read()
	f.Tokens[name] = token
	return write(f)
}

// Remove forgets name; if it was in use, threads go back to the CLI's login.
func Remove(name string) error {
	mu.Lock()
	defer mu.Unlock()
	f := read()
	if _, ok := f.Tokens[name]; !ok {
		return errors.New("no Claude account named " + name)
	}
	delete(f.Tokens, name)
	return write(f)
}

// Use makes name the account new Claude threads run under (Terminal or "" =
// the CLI's login). Running threads keep theirs until they restart.
func Use(name string) error {
	mu.Lock()
	defer mu.Unlock()
	f := read()
	if name == "" || strings.EqualFold(name, Terminal) {
		f.Active = ""
	} else if _, ok := f.Tokens[name]; ok {
		f.Active = name
	} else {
		return errors.New("no Claude account named " + name)
	}
	return write(f)
}

// Names: the stored accounts, sorted, and the one in use ("" = the CLI's login).
func Names() (names []string, active string) {
	mu.Lock()
	defer mu.Unlock()
	f := read()
	for n := range f.Tokens {
		names = append(names, n)
	}
	sort.Strings(names)
	return names, f.Active
}

// Tokens: every stored account's token, by name (for its usage).
func Tokens() map[string]string {
	mu.Lock()
	defer mu.Unlock()
	return read().Tokens
}

// Env: the account a new claude runs under ("" = the CLI's login) and the
// environment to add for it.
func Env() (account string, env []string) {
	mu.Lock()
	defer mu.Unlock()
	f := read()
	if f.Active == "" {
		return "", nil
	}
	return f.Active, []string{"CLAUDE_CODE_OAUTH_TOKEN=" + f.Tokens[f.Active]}
}

// List is GET /claude-accounts' answer: names only, never tokens.
type List struct {
	Accounts []string `json:"accounts"` // besides Terminal
	Active   string   `json:"active"`   // "" = Terminal
}

// Routes: GET /claude-accounts, PUT /claude-accounts/active {name}.
func Routes(mux *http.ServeMux, wrap httpx.Wrap) {
	list := func(w http.ResponseWriter) {
		names, active := Names()
		httpx.WriteJSON(w, List{Accounts: httpx.OrEmpty(names), Active: active})
	}
	mux.HandleFunc("GET /claude-accounts", wrap(func(w http.ResponseWriter, r *http.Request) { list(w) }))
	mux.HandleFunc("PUT /claude-accounts/active", wrap(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name string `json:"name"`
		}
		if !httpx.ReadJSON(w, r, &req) {
			return
		}
		if err := Use(req.Name); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		list(w)
	}))
}

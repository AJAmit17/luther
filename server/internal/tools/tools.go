// Package tools: Luther's own tools for the agents it runs, over MCP.
//
// Every thread Luther opens gets `luther mcp` as an MCP server (stdio), started
// by the agent with a token for that thread. `luther mcp` relays MCP's
// tools/list and tools/call to the running server (GET/POST /agent-tools),
// which knows the thread from the token. The routes take the token only from
// this Mac, never through a tunnel.
package tools

import (
	"os"
	"strconv"
	"sync"

	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/text"
)

const (
	envURL   = "LUTHER_TOOL_URL"
	envToken = "LUTHER_TOOL_TOKEN"
)

var reg = struct {
	sync.Mutex
	thread   map[string]string          // token → thread id ("" until bound)
	children map[string]map[string]bool // thread id → threads it started
}{thread: map[string]string{}, children: map[string]map[string]bool{}}

// ForThread: a new token and the server spec an agent starts for one thread.
// Bind the token once the thread has its id.
func ForThread(port int) (string, *protocol.ToolServer) {
	tok := text.RandHex(24)
	reg.Lock()
	reg.thread[tok] = ""
	reg.Unlock()
	exe, err := os.Executable()
	if err != nil {
		exe = "luther"
	}
	return tok, &protocol.ToolServer{Command: exe, Args: []string{"mcp"},
		Env: map[string]string{envURL: "http://127.0.0.1:" + strconv.Itoa(port), envToken: tok}}
}

func Bind(tok, thread string) {
	reg.Lock()
	defer reg.Unlock()
	if _, ok := reg.thread[tok]; ok {
		reg.thread[tok] = thread
	}
}

// Drop forgets a token whose thread never opened.
func Drop(tok string) {
	reg.Lock()
	defer reg.Unlock()
	delete(reg.thread, tok)
}

// Thread: the thread a token belongs to, or "".
func Thread(tok string) string {
	reg.Lock()
	defer reg.Unlock()
	return reg.thread[tok]
}

func AddChild(parent, child string) {
	reg.Lock()
	defer reg.Unlock()
	if reg.children[parent] == nil {
		reg.children[parent] = map[string]bool{}
	}
	reg.children[parent][child] = true
}

func IsChild(parent, child string) bool {
	reg.Lock()
	defer reg.Unlock()
	return reg.children[parent][child]
}

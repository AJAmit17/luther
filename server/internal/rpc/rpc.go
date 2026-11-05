// Package rpc: newline-delimited JSON-RPC over a child process's stdio, both
// ways — our calls and their answers, plus the agent's own requests and
// notifications. Codex's app-server and every ACP agent speak it.
package rpc

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"time"
)

type Err struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Msg: one line. A response has no Method; a request has Method and ID; a
// notification has Method only.
type Msg struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *Err            `json:"error,omitempty"`
}

// Conn: the writing side plus the calls waiting for answers. Read drives it.
type Conn struct {
	name    string // for errors: "codex", "OpenCode"
	jsonrpc bool   // stamp "jsonrpc":"2.0" (ACP wants it; Codex doesn't)

	inMu sync.Mutex
	in   io.Writer

	mu      sync.Mutex
	next    int64
	pending map[string]chan Msg
	dead    bool
}

func New(name string, in io.Writer, jsonrpc bool) *Conn {
	return &Conn{name: name, in: in, jsonrpc: jsonrpc, pending: map[string]chan Msg{}}
}

func (c *Conn) Dead() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.dead
}

func (c *Conn) send(m map[string]any) error {
	if c.jsonrpc {
		m["jsonrpc"] = "2.0"
	}
	b, _ := json.Marshal(m)
	c.inMu.Lock()
	defer c.inMu.Unlock()
	_, err := c.in.Write(append(b, '\n'))
	return err
}

// Call waits up to two minutes for the answer.
func (c *Conn) Call(method string, params any) (json.RawMessage, error) {
	return c.CallWait(method, params, 2*time.Minute)
}

// CallWait: wait 0 waits until the answer or the process's end (an ACP prompt
// answers only when its whole turn is over).
func (c *Conn) CallWait(method string, params any, wait time.Duration) (json.RawMessage, error) {
	c.mu.Lock()
	if c.dead {
		c.mu.Unlock()
		return nil, fmt.Errorf("%s is not running", c.name)
	}
	c.next++
	id := c.next
	ch := make(chan Msg, 1)
	c.pending[fmt.Sprint(id)] = ch
	c.mu.Unlock()
	if err := c.send(map[string]any{"id": id, "method": method, "params": params}); err != nil {
		return nil, err
	}
	var timeout <-chan time.Time
	if wait > 0 {
		timeout = time.After(wait)
	}
	select {
	case m := <-ch:
		if m.Error != nil {
			return nil, fmt.Errorf("%s %s: %s", c.name, method, m.Error.Message)
		}
		return m.Result, nil
	case <-timeout:
		c.mu.Lock()
		delete(c.pending, fmt.Sprint(id))
		c.mu.Unlock()
		return nil, fmt.Errorf("%s %s: timed out", c.name, method)
	}
}

func (c *Conn) Notify(method string, params any) error {
	return c.send(map[string]any{"method": method, "params": params})
}

func (c *Conn) Reply(id json.RawMessage, result any) error {
	return c.send(map[string]any{"id": id, "result": result})
}

func (c *Conn) ReplyErr(id json.RawMessage, msg string) {
	c.send(map[string]any{"id": id, "error": Err{Code: -32601, Message: msg}})
}

// Read: every line until EOF. Answers resolve calls; requests and
// notifications go to handle (on this goroutine, in order). Lines that aren't
// JSON (some agents' plugins print to stdout) are skipped. At EOF every
// waiting call fails and Dead turns true.
func (c *Conn) Read(out io.Reader, handle func(Msg)) {
	br := bufio.NewReaderSize(out, 1<<20)
	for {
		line, err := br.ReadBytes('\n')
		var m Msg
		if len(line) > 1 && json.Unmarshal(line, &m) == nil {
			if m.Method == "" {
				c.mu.Lock()
				ch := c.pending[string(m.ID)]
				delete(c.pending, string(m.ID))
				c.mu.Unlock()
				if ch != nil {
					ch <- m
				}
			} else {
				handle(m)
			}
		}
		if err != nil {
			break
		}
	}
	c.mu.Lock()
	c.dead = true
	for id, ch := range c.pending {
		ch <- Msg{Error: &Err{Message: c.name + " exited"}}
		delete(c.pending, id)
	}
	c.mu.Unlock()
}

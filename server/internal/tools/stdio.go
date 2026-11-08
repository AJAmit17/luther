package tools

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/AJAmit17/luther/server/internal/text"
)

// Serve is `luther mcp`: MCP over stdio (newline-delimited JSON-RPC 2.0),
// relaying the tools to the running server. Started by an agent, never by hand.
func Serve(in io.Reader, out io.Writer) error {
	url, tok := os.Getenv(envURL), os.Getenv(envToken)
	if url == "" || tok == "" {
		return errors.New("luther mcp is started by the agents Luther runs; it needs " + envURL + " and " + envToken)
	}
	c := &relay{url: url, tok: tok, http: &http.Client{Timeout: 35 * time.Minute}}
	var mu sync.Mutex
	var pending sync.WaitGroup
	defer pending.Wait() // answer what was asked before stdin closed
	reply := func(v any) {
		b, _ := json.Marshal(v)
		mu.Lock()
		out.Write(append(b, '\n'))
		mu.Unlock()
	}
	br := bufio.NewReaderSize(in, 1<<20)
	for {
		line, err := br.ReadBytes('\n')
		if len(bytes.TrimSpace(line)) > 0 {
			var req struct {
				ID     json.RawMessage `json:"id"`
				Method string          `json:"method"`
				Params json.RawMessage `json:"params"`
			}
			if json.Unmarshal(line, &req) == nil && req.ID != nil { // notifications need no answer
				pending.Add(1)
				go func() { // wait_for_thread can block
					defer pending.Done()
					reply(c.handle(req.ID, req.Method, req.Params))
				}()
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

type relay struct {
	url, tok string
	http     *http.Client
}

func (c *relay) handle(id json.RawMessage, method string, params json.RawMessage) map[string]any {
	ok := func(result any) map[string]any { return map[string]any{"jsonrpc": "2.0", "id": id, "result": result} }
	fail := func(code int, msg string) map[string]any {
		return map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": msg}}
	}
	switch method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		json.Unmarshal(params, &p)
		return ok(map[string]any{
			"protocolVersion": text.OrDefault(p.ProtocolVersion, "2025-06-18"),
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]string{"name": "luther", "title": "Luther", "version": "1"},
			"instructions": "Luther runs you on the user's Mac and shows this conversation on their phone. " +
				"Use show_artifact to put an HTML page in front of them, and start_thread / send_message / wait_for_thread " +
				"to hand work to other coding agents.",
		})
	case "ping":
		return ok(map[string]any{})
	case "tools/list":
		var tools json.RawMessage
		if err := c.do("GET", "/agent-tools", nil, &tools); err != nil {
			return fail(-32603, err.Error())
		}
		return ok(map[string]any{"tools": tools})
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		json.Unmarshal(params, &p)
		var res struct {
			Text    string `json:"text"`
			IsError bool   `json:"isError"`
		}
		if err := c.do("POST", "/agent-tools/"+p.Name, p.Arguments, &res); err != nil {
			res.Text, res.IsError = err.Error(), true
		}
		return ok(map[string]any{"content": []map[string]string{{"type": "text", "text": res.Text}}, "isError": res.IsError})
	}
	return fail(-32601, "method not found: "+method)
}

func (c *relay) do(method, path string, body json.RawMessage, out any) error {
	if len(body) == 0 || string(body) == "null" {
		body = json.RawMessage("{}")
	}
	req, _ := http.NewRequest(method, c.url+path, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+c.tok)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("Luther isn't reachable: %w", err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode != 200 {
		return fmt.Errorf("luther: %s", strings.TrimSpace(string(b)))
	}
	return json.Unmarshal(b, out)
}

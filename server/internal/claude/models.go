package claude

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"time"

	"github.com/AJAmit17/luther/server/internal/protocol"
)

// Models: the models Claude Code offers this account, named as its /model
// menu names them ("Opus 5.5", with the full model ID each alias resolves to).
// Asked of a short-lived `claude` that only answers the initialize request:
// no prompt is sent, so no conversation is created. Run in a scratch folder
// outside your home.
func Models() ([]protocol.Model, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	// A fresh private folder, never a fixed shared path: a folder someone else
	// made could hold project settings (hooks) that Claude Code would run.
	dir, err := os.MkdirTemp("", "luther-models-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	cmd := exec.CommandContext(ctx, Bin, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose")
	cmd.Dir = dir
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	defer func() {
		in.Close()
		cmd.Process.Kill()
		cmd.Wait()
	}()
	req, _ := json.Marshal(map[string]any{"type": "control_request", "request_id": "luther-models", "request": map[string]any{"subtype": "initialize"}})
	if _, err := in.Write(append(req, '\n')); err != nil {
		return nil, err
	}
	sc := bufio.NewScanner(out)
	sc.Buffer(make([]byte, 1<<20), 16<<20)
	for sc.Scan() {
		ms, ok := parseInitModels(sc.Bytes())
		if ok {
			return ms, nil
		}
	}
	return nil, fmt.Errorf("claude models: no answer (%v)", ctx.Err())
}

// parseInitModels: the models in Claude Code's answer to initialize; ok is
// false for any other line.
func parseInitModels(line []byte) ([]protocol.Model, bool) {
	var r struct {
		Type     string `json:"type"`
		Response struct {
			ID       string `json:"request_id"`
			Response struct {
				Models []struct {
					Value       string `json:"value"`
					Resolved    string `json:"resolvedModel"`
					DisplayName string `json:"displayName"`
					Description string `json:"description"`
				} `json:"models"`
			} `json:"response"`
		} `json:"response"`
	}
	if json.Unmarshal(line, &r) != nil || r.Type != "control_response" || r.Response.ID != "luther-models" {
		return nil, false
	}
	var ms []protocol.Model
	for _, m := range r.Response.Response.Models {
		if m.Value == "default" {
			continue // the app's own "Default" covers it
		}
		ms = append(ms, protocol.Model{ID: m.Value, Name: m.DisplayName, Desc: m.Description, Resolved: m.Resolved})
	}
	return ms, true
}

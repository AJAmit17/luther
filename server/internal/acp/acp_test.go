package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/rpc"
	"github.com/AJAmit17/luther/server/internal/usage"
)

func TestDevinACP(t *testing.T) {
	paths.Home = t.TempDir()
	agent, ok := Find(protocol.Provider("devin"))
	if !ok || agent.Bins[0] != "devin" || strings.Join(agent.Args, " ") != "acp" {
		t.Fatal("Devin must use the released ACP entrypoint")
	}
	toAgent, clientIn := io.Pipe()
	toClient, agentOut := io.Pipe()
	defer toAgent.Close()
	defer clientIn.Close()
	defer toClient.Close()
	defer agentOut.Close()
	s := &server{Conn: rpc.New("fake Devin", clientIn, true), agent: agent, rts: map[string]*runtime{}}
	go s.Read(toClient, s.dispatch)
	var writeMu sync.Mutex
	write := func(m any) {
		writeMu.Lock()
		defer writeMu.Unlock()
		json.NewEncoder(agentOut).Encode(m)
	}
	update := func(u any) {
		write(map[string]any{"method": "session/update", "params": map[string]any{"sessionId": "test-devin", "update": u}})
	}
	var pending json.RawMessage
	var cancelTurn bool
	configValues := make(chan string, 10)
	prompts := make(chan struct{}, 2)
	go func() {
		reader := bufio.NewReader(toAgent)
		for {
			line, err := reader.ReadBytes('\n')
			if err != nil {
				return
			}
			var m rpc.Msg
			if json.Unmarshal(line, &m) != nil {
				continue
			}
			reply := func(result any) { write(map[string]any{"id": m.ID, "result": result}) }
			switch m.Method {
			case "session/set_config_option":
				var p struct {
					ConfigID string
					Value    string
				}
				json.Unmarshal(m.Params, &p)
				configValues <- p.ConfigID + "=" + p.Value
				reply(map[string]any{})
			case "session/prompt":
				pending = m.ID
				prompts <- struct{}{}
				if cancelTurn {
					continue
				}
				write(map[string]any{"id": "permission", "method": "session/request_permission", "params": map[string]any{
					"sessionId": "test-devin", "toolCall": map[string]any{"title": "Run tests", "kind": "execute"},
					"options": []any{map[string]string{"optionId": "yes", "name": "Allow once", "kind": "allow_once"}, map[string]string{"optionId": "no", "name": "Deny", "kind": "reject_once"}},
				}})
			case "session/cancel":
				write(map[string]any{"id": pending, "result": map[string]any{"stopReason": "cancelled"}})
			case "session/close":
				reply(map[string]any{})
			case "":
				if string(m.ID) == `"permission"` {
					update(map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{"type": "text", "text": "Tests passed"}})
					update(map[string]any{"sessionUpdate": "usage_update", "used": 9000, "cost": map[string]any{"amount": 0.03, "currency": "USD"}})
					write(map[string]any{"id": pending, "result": map[string]any{"stopReason": "end_turn", "usage": map[string]int{"inputTokens": 10, "outputTokens": 20, "cachedReadTokens": 30}}})
					cancelTurn = true
				}
			}
		}
	}()
	thread, rt := s.newThread("test-devin", paths.Home, protocol.ModeAsk)
	var resp sessionResp
	json.Unmarshal([]byte(`{"configOptions":[{"id":"model","category":"model","currentValue":"model-a","options":[{"group":"Group","options":[{"value":"model-a","name":"A"},{"value":"model-b","name":"B"}]}]},{"id":"mode","category":"mode","currentValue":"accept-edits","options":[{"value":"ask"},{"value":"accept-edits"},{"value":"plan"},{"value":"bypass"}]}]}`), &resp)
	rt.configure(resp)
	if len(s.models) != 2 {
		t.Fatalf("grouped models lost: %v", s.models)
	}
	if err := rt.SetModel("model-b"); err != nil {
		t.Fatal(err)
	}
	if got := <-configValues; got != "model=model-b" {
		t.Fatal(got)
	}
	for _, mode := range []struct{ Luther, Native string }{
		{protocol.ModeAsk, "ask"}, {protocol.ModePlan, "plan"}, {protocol.ModeFull, "bypass"}, {protocol.ModeEdits, "accept-edits"}, {protocol.ModeAsk, "ask"},
	} {
		if err := rt.SetMode(mode.Luther); err != nil {
			t.Fatal(err)
		}
		if got := <-configValues; got != "mode="+mode.Native {
			t.Fatal(got)
		}
	}
	hub.Register(thread)
	defer rt.Stop()
	mux := http.NewServeMux()
	hub.Routes(mux, func(fn http.HandlerFunc) http.HandlerFunc { return fn })
	httpServer := httptest.NewServer(mux)
	defer httpServer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/threads/test-devin/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	if err := thread.Send("run tests", nil); err != nil {
		t.Fatal(err)
	}
	<-prompts
	for {
		_, raw, err := ws.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var f struct {
			Type   string
			Prompt protocol.Prompt
		}
		json.Unmarshal(raw, &f)
		if f.Type == "prompt" {
			if err := thread.Answer(protocol.Answer{ID: f.Prompt.ID, Choice: 0}); err != nil {
				t.Fatal(err)
			}
			break
		}
	}
	wait := func(want func() bool) {
		t.Helper()
		for ctx.Err() == nil {
			if want() {
				return
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatal("timed out")
	}
	wait(func() bool { return !thread.State().Busy })
	wait(func() bool { return usage.History(7, time.Now()).Total.OutputTokens == 20 })
	if st := thread.State(); st.ContextTokens != 9000 || st.Usage.InputTokens != 10 || st.Usage.CacheReadTokens != 30 || st.Model != "model-b" {
		t.Fatalf("context occupancy must not become token burn: %+v", st)
	}
	if err := thread.Send("cancel this", nil); err != nil {
		t.Fatal(err)
	}
	<-prompts
	if err := rt.Interrupt(); err != nil {
		t.Fatal(err)
	}
	wait(func() bool { return !thread.State().Busy })
	if report := usage.History(7, time.Now()); report.Total.InputTokens != 10 || report.Total.OutputTokens != 20 {
		t.Fatalf("cancellation duplicated usage: %+v", report.Total)
	}
}

// Model choices keep the agent's names; groups come from option groups or the
// "provider/" prefix; the older availableModels form still works.
func TestModelsOf(t *testing.T) {
	var r sessionResp
	json.Unmarshal([]byte(`{"configOptions":[{"id":"model","category":"model","currentValue":"a","options":[
		{"value":"claude-opus-5-5-medium","name":"Claude Opus 5.5"},
		{"name":"Fast","options":[{"value":"swe-2-flash","name":"SWE-2 Flash"}]},
		{"value":"openrouter/x/y","name":"OpenRouter/Y","description":"openrouter/x/y"}]}]}`), &r)
	got := modelsOf(r)
	want := []protocol.Model{
		{ID: "claude-opus-5-5-medium", Name: "Claude Opus 5.5"},
		{ID: "swe-2-flash", Name: "SWE-2 Flash", Group: "Fast"},
		{ID: "openrouter/x/y", Name: "OpenRouter/Y", Group: "openrouter"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i := range want {
		if !reflect.DeepEqual(got[i], want[i]) {
			t.Errorf("%d: got %+v want %+v", i, got[i], want[i])
		}
	}
	var old sessionResp
	json.Unmarshal([]byte(`{"models":{"availableModels":[{"modelId":"m1","name":"Model One"}]}}`), &old)
	if ms := modelsOf(old); len(ms) != 1 || ms[0].Name != "Model One" {
		t.Fatalf("availableModels: %+v", ms)
	}
}

// Devin and Oh My Pi offer effort as a "thought_level" option; Devin's
// "speed" option is its fast mode.
func TestKnobs(t *testing.T) {
	var r sessionResp
	json.Unmarshal([]byte(`{"configOptions":[
		{"id":"model","category":"model","currentValue":"m","options":[{"value":"m","name":"M"},{"value":"fast","name":"not speed"}]},
		{"id":"thought_level","category":"thought_level","currentValue":"high","options":[{"value":"low"},{"value":"high"},{"value":"max"}]},
		{"id":"speed","category":"model_config","currentValue":"standard","options":[{"value":"standard"},{"value":"fast"}]}]}`), &r)
	k := knobsOf(r.Config)
	if k.effortID != "thought_level" || k.effort != "high" || !reflect.DeepEqual(k.efforts, []string{"low", "high", "max"}) {
		t.Errorf("effort: %+v", k)
	}
	if k.fastID != "speed" || k.fast != "off" || k.fastOn != "fast" || k.fastOff != "standard" {
		t.Errorf("fast: %+v", k)
	}
	if ms := modelsOf(r); len(ms) != 2 || ms[0].Effort != "high" || !ms[0].Fast {
		t.Errorf("models: %+v", ms)
	}
}

// An agent that lists its models only in the older models field (Gemini CLI)
// is switched with session/set_model, and its current model shows.
func TestOldModelField(t *testing.T) {
	paths.Home = t.TempDir()
	agent, _ := Find(protocol.Provider("gemini"))
	toAgent, clientIn := io.Pipe()
	defer toAgent.Close()
	defer clientIn.Close()
	s := &server{Conn: rpc.New("fake Gemini", clientIn, true), agent: agent, rts: map[string]*runtime{}}
	got := make(chan string, 1)
	go func() {
		line, _ := bufio.NewReader(toAgent).ReadBytes('\n')
		var m rpc.Msg
		json.Unmarshal(line, &m)
		var p struct{ SessionID, ModelID string }
		json.Unmarshal(m.Params, &p)
		got <- m.Method + " " + p.SessionID + " " + p.ModelID
	}()
	thread, rt := s.newThread("g1", paths.Home, protocol.ModeAsk)
	var resp sessionResp
	json.Unmarshal([]byte(`{"models":{"currentModelId":"auto","availableModels":[{"modelId":"auto"},{"modelId":"flash"}]}}`), &resp)
	rt.configure(resp)
	if st := thread.State(); st.Model != "auto" {
		t.Fatalf("current model not shown: %q", st.Model)
	}
	go rt.SetModel("flash") // the fake peer never replies; the request is what matters
	select {
	case m := <-got:
		if m != "session/set_model g1 flash" {
			t.Fatal(m)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no session/set_model")
	}
}

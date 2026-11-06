package claude

import (
	"testing"
	"time"

	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/AJAmit17/luther/server/internal/usage"
)

func TestReportedCostDoesNotDuplicateTranscriptTokens(t *testing.T) {
	paths.Home = t.TempDir()
	thread := hub.New("test", protocol.State{Provider: protocol.Claude, Session: "session", Model: "sonnet"})
	rt := &runtime{t: thread}
	rt.handle([]byte(`{"type":"result","uuid":"result-1","total_cost_usd":0.12,"usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":30,"cache_creation_input_tokens":40}}`))
	st := thread.State()
	if st.Usage == nil || st.Usage.CacheReadTokens != 30 || st.Usage.CacheWriteTokens != 40 {
		t.Fatalf("live cache usage: %+v", st.Usage)
	}
	report := usage.History(7, time.Now())
	if !report.Total.CostReported || report.Total.CostUSD != 0.12 || report.Total.InputTokens != 0 || report.Total.CacheReadTokens != 0 {
		t.Fatalf("cost receipts must leave token counting to the transcripts: %+v", report.Total)
	}
}

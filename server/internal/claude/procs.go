package claude

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"github.com/AJAmit17/luther/server/internal/hub"
	"github.com/AJAmit17/luther/server/internal/paths"
	"github.com/AJAmit17/luther/server/internal/protocol"
)

// ---- one writer per session: Claude Code's process registry (~/.claude/sessions/<pid>.json) ----

type proc struct {
	Pid int
	Sid string
}

func procs() []proc {
	paths, _ := filepath.Glob(filepath.Join(paths.Home, ".claude", "sessions", "*.json"))
	var out []proc
	for _, p := range paths {
		var rec struct {
			Pid       int    `json:"pid"`
			SessionID string `json:"sessionId"`
		}
		b, err := os.ReadFile(p)
		if err != nil || json.Unmarshal(b, &rec) != nil || rec.Pid <= 0 {
			continue
		}
		// Stale files outlive crashed processes; EPERM still means alive.
		if err := syscall.Kill(rec.Pid, 0); err != nil && err != syscall.EPERM {
			continue
		}
		out = append(out, proc{Pid: rec.Pid, Sid: rec.SessionID})
	}
	return out
}

// ours: pids of Luther's own claude processes.
func ours() map[int]bool {
	pids := map[int]bool{}
	for _, t := range hub.List() {
		if c, ok := t.Runtime().(*runtime); ok {
			pids[c.cmd.Process.Pid] = true
		}
	}
	return pids
}

func heldOutside(sid string) bool {
	ours := ours()
	for _, p := range procs() {
		if p.Sid == sid && !ours[p.Pid] {
			return true
		}
	}
	return false
}

// Busy: sessions held by a claude outside Luther.
func Busy() map[string]bool {
	ours := ours()
	busy := map[string]bool{}
	for _, p := range procs() {
		if !ours[p.Pid] {
			busy[p.Sid] = true
		}
	}
	return busy
}

// takeOver ends outside claude processes holding sid ("Move to Luther").
// SIGTERM lets claude exit cleanly (the transcript is on disk); SIGKILL after 8s.
func takeOver(sid string) error {
	var pids []int
	for _, p := range procs() {
		if p.Sid == sid {
			pids = append(pids, p.Pid)
		}
	}
	for _, pid := range pids {
		syscall.Kill(pid, syscall.SIGTERM)
	}
	for _, pid := range pids {
		deadline := time.Now().Add(8 * time.Second)
		for syscall.Kill(pid, 0) == nil {
			if time.Now().After(deadline) {
				syscall.Kill(pid, syscall.SIGKILL)
				time.Sleep(200 * time.Millisecond)
				break
			}
			time.Sleep(100 * time.Millisecond)
		}
		if syscall.Kill(pid, 0) == nil {
			return fmt.Errorf("could not stop claude (pid %d)", pid)
		}
	}
	return nil
}

// WatchDups flags open Claude threads whose session a CLI outside Luther has
// also opened; both would write the transcript, so every client warns.
func WatchDups() {
	for range time.Tick(5 * time.Second) {
		busy := Busy()
		for _, t := range hub.List() {
			if _, ok := t.Runtime().(*runtime); !ok {
				continue
			}
			t.SetDup(busy[t.State().Session])
		}
	}
}

// todos: the task list from a TodoWrite tool call, if this message has one.
func todos(r chatRec) ([]protocol.Task, bool) {
	var blocks []block
	if json.Unmarshal(r.Message.Content, &blocks) != nil {
		return nil, false
	}
	for _, b := range blocks {
		if b.Type == "tool_use" && b.Name == "TodoWrite" {
			raw, _ := json.Marshal(b.Input["todos"])
			var ts []struct{ Content, Status, ActiveForm string }
			json.Unmarshal(raw, &ts)
			out := []protocol.Task{}
			for _, x := range ts {
				label := x.Content
				if x.Status == "in_progress" && x.ActiveForm != "" {
					label = x.ActiveForm
				}
				out = append(out, protocol.Task{Text: label, Status: x.Status})
			}
			return out, true
		}
	}
	return nil, false
}

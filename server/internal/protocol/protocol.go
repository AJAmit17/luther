// Package protocol: the wire types between `luther serve` and the phone app.
package protocol

import "time"

// Wire protocol between `luther serve` and the phone app. These types are the
// source of truth; app/src/lib/protocol.ts mirrors them (change both together).
//
// HTTP (JSON, bearer device token on everything except /healthz and POST /pair):
//   GET  /healthz                         → {ok, name, version}
//   POST /pair {pub, box}                 → {box}  box = sealed {code, name, t} → sealed {deviceId, token} (package seal)
//   POST /e  (X-Luther-Device, sealed)    → sealed response: any other request, end-to-end encrypted (package e2e)
//   GET  /e/ws?d=&b=  (WS)                → any WebSocket above, each frame sealed
//   POST /pair/code                       → {code, expires}        (admin token only: the CLI)
//   GET  /devices · DELETE /devices/{id}
//   GET  /events  (WS)                    → {type:"run", run: Run} for every thread, on every change
//   GET  /runs                            → [Run] (open threads; for background refresh)
//   POST /threads/{id}/interrupt          (the Live Activity's Stop)
//   POST /threads/{id}/answer Answer      (a notification's Approve / Deny / Reply)
//   GET  /threads/{id}/turns              → [Turn] · GET …/turns/{n}/diff (text) · POST …/turns/{n}/revert
//   GET  /providers                       → [ProviderInfo]
//   GET  /models?provider=                → [string]
//   GET  /projects                        → [Project]
//   GET  /dirs?path=                      → [string] (folders under $HOME)
//   GET  /sessions?cwd=|q=[&archived=1]   → [Session] (past conversations of every provider; worktrees fold into their repo)
//   PATCH /sessions/{provider}/{id} {title?, pinned?, archived?}
//   POST /uploads?name=  (raw body ≤ 25 MB) → {path}  (attach to the next send)
//   POST /threads OpenReq                 → {id}     (409: held by a CLI outside Luther)
//   GET  /threads                         → [ThreadInfo] (open threads)
//   DELETE /threads/{id}
//   GET  /threads/{id}/events  (WS)       → Frame stream; in: ClientFrame
//   GET  /commands?provider=&cwd=         → [Command]
//   GET  /terms · POST /terms {cwd} → {name} · DELETE /terms/{name}
//   GET  /terms/{name}/events  (WS)       → {type:"screen",ansi} | {type:"ended"}; in: {type:"size",cols,rows} | {type:"input",hex}
//   GET  /files?cwd=&path=                → FileEntry list (dir) or FileContent (file)
//   PUT  /files {cwd, path, text, base}   → FileContent (base: the hash you edited; "" creates; 409 if it changed)
//   GET  /git/status?cwd= · GET /git/diff?cwd=&path= · POST /git/commit {cwd, message}
//   POST /git/push {cwd} · POST /git/pr {cwd, title, body} → {url} · DELETE /git/worktree?cwd=
//   GET  /schedules → [Job] · POST /schedules Job (create, or update by id) → Job · DELETE /schedules/{id} · POST /schedules/{id}/run → {thread}
//   GET  /usage                           → [Limits] (plan usage per agent)
//   GET  /ports                           → [Port] (dev servers listening on this Mac)
//   POST /previews {port}                 → {path} (open route+path in a browser: no token needed, it is one)

type Provider string

const (
	Claude   Provider = "claude"
	Codex    Provider = "codex"
	OpenCode Provider = "opencode" // the rest speak ACP (package acp)
	Gemini   Provider = "gemini"
	Cursor   Provider = "cursor"
	Devin    Provider = "devin"
)

// Permission modes, normalized across providers.
const (
	ModeAsk   = "ask"   // ask before edits and commands
	ModeEdits = "edits" // auto-accept file edits
	ModePlan  = "plan"  // plan only (read-only)
	ModeFull  = "full"  // no prompts, full access
)

type ProviderInfo struct {
	ID        Provider `json:"id"`
	Name      string   `json:"name"`
	Installed bool     `json:"installed"`
	Version   string   `json:"version,omitempty"`
	Modes     []string `json:"modes"`
}

type Project struct {
	Cwd        string    `json:"cwd"`
	Name       string    `json:"name"`
	Sessions   int       `json:"sessions"`
	LastActive time.Time `json:"lastActive"`
	Live       int       `json:"live"` // open threads + terminals here
}

// Session: a past conversation in a provider's own store.
type Session struct {
	Provider   Provider  `json:"provider"`
	ID         string    `json:"id"` // provider's native session/thread id
	Cwd        string    `json:"cwd"`
	Title      string    `json:"title"`
	Preview    string    `json:"preview"`
	LastActive time.Time `json:"lastActive"`
	Live       string    `json:"live"` // open thread id, if any
	Busy       bool      `json:"busy"` // held by a CLI outside Luther
	Pinned     bool      `json:"pinned,omitempty"`
	Archived   bool      `json:"archived,omitempty"`
	Worktree   string    `json:"worktree,omitempty"` // branch, when it ran in a Luther worktree of this project
}

type OpenReq struct {
	Provider Provider `json:"provider"`
	Cwd      string   `json:"cwd"`
	Resume   string   `json:"resume,omitempty"` // native session id
	Fork     bool     `json:"fork,omitempty"`
	Move     bool     `json:"move,omitempty"` // stop the CLI holding it, then host it here
	Model    string   `json:"model,omitempty"`
	Mode     string   `json:"mode,omitempty"`
	Worktree bool     `json:"worktree,omitempty"` // new thread in its own git worktree + branch
}

type ThreadInfo struct {
	ID string `json:"id"`
	State
	Title   string `json:"title"`
	Clients int    `json:"clients"`
}

// State of one open thread; sent in snapshot and on every change.
type State struct {
	Provider      Provider `json:"provider"`
	Session       string   `json:"session"` // native id; changes on Claude's /clear
	Cwd           string   `json:"cwd"`
	Busy          bool     `json:"busy"`
	Activity      string   `json:"activity"`
	Model         string   `json:"model"`
	Mode          string   `json:"mode"`
	Commands      []string `json:"commands,omitempty"`
	Usage         *Usage   `json:"usage,omitempty"`
	ContextTokens int64    `json:"contextTokens,omitempty"`
	Tasks         []Task   `json:"tasks,omitempty"` // the agent's own todo list / plan
	Dup           bool     `json:"dup,omitempty"`   // a CLI outside Luther also has it open
}

type Task struct {
	Text   string `json:"text"`
	Status string `json:"status"` // pending | in_progress | completed
}

// Turn: one user turn's checkpoint (git trees before and after), for diff and revert.
type Turn struct {
	N         int    `json:"n"`
	Prompt    string `json:"prompt"`
	StartedAt int64  `json:"startedAt"`
	EndedAt   int64  `json:"endedAt,omitempty"`
	Files     int    `json:"files"` // changed by the turn
}

type Usage struct {
	InputTokens      int64   `json:"inputTokens"`
	OutputTokens     int64   `json:"outputTokens"`
	CostUSD          float64 `json:"costUsd,omitempty"`
	CacheReadTokens  int64   `json:"cacheReadTokens,omitempty"`
	CacheWriteTokens int64   `json:"cacheWriteTokens,omitempty"`
	CostReported     bool    `json:"costReported,omitempty"`
}

type UsageDay struct {
	Date string `json:"date"`
	Usage
}

type UsageBreakdown struct {
	Provider Provider `json:"provider"`
	Model    string   `json:"model,omitempty"`
	Usage
}

type UsageHistory struct {
	Days      []UsageDay       `json:"days"`
	Total     Usage            `json:"total"`
	Breakdown []UsageBreakdown `json:"breakdown"`
	Updated   int64            `json:"updated"`
	Notes     []string         `json:"notes"`
}

type Repository struct {
	Cwd     string `json:"cwd"`
	Name    string `json:"name"`
	Branch  string `json:"branch"`
	Changes int    `json:"changes"`
	Error   string `json:"error,omitempty"`
}

// Msg: one chat row.
type Msg struct {
	ID   string `json:"id"`
	Role string `json:"role"` // user | assistant | tool | system
	Text string `json:"text"`
	Tool string `json:"tool,omitempty"`
	// Parent: the subagent call (that tool row's ID) this step belongs to.
	Parent string `json:"parent,omitempty"`
}

// Limits: an agent's plan usage, per window. Claude reports it during turns;
// Codex answers on request.
type Limits struct {
	Provider Provider `json:"provider"`
	Plan     string   `json:"plan,omitempty"`
	Windows  []Window `json:"windows"`
	Updated  int64    `json:"updated"` // ms
}

type Window struct {
	Label    string  `json:"label"`              // "5 hours", "7 days"
	Used     float64 `json:"used"`               // percent, 0–100
	ResetsAt int64   `json:"resetsAt,omitempty"` // ms
}

type Option struct {
	Label string `json:"label"`
	Desc  string `json:"desc,omitempty"`
}

type Question struct {
	ID          string   `json:"id"`
	Question    string   `json:"question"`
	Header      string   `json:"header,omitempty"`
	Options     []Option `json:"options"`
	MultiSelect bool     `json:"multiSelect,omitempty"`
}

// Prompt: the agent is blocked on the user. permission/plan are answered with
// an option index; question with answers. First answer from any client wins.
type Prompt struct {
	ID        string     `json:"id"`
	Kind      string     `json:"kind"` // permission | question | plan
	Tool      string     `json:"tool"`
	Title     string     `json:"title"`
	Body      string     `json:"body,omitempty"`
	Options   []Option   `json:"options,omitempty"`
	Questions []Question `json:"questions,omitempty"`

	Priv any `json:"-"` // provider-side data needed to answer
}

// Answer: Choice indexes Options (-1 = decline, with Message as "do this instead").
// Answers maps Question.ID → chosen labels (or free text).
type Answer struct {
	ID      string              `json:"id"`
	Choice  int                 `json:"choice"`
	Answers map[string][]string `json:"answers,omitempty"`
	Message string              `json:"message,omitempty"`
}

// Frames, server → client (WS /threads/{id}/events):
//   {type:"snapshot", state, messages, draft, prompts}
//   {type:"message", message} · {type:"messages", messages, reset}
//   {type:"draft", delta} · {type:"draft", reset:true}
//   {type:"state", state} · {type:"prompt", prompt} · {type:"prompt_closed", id}
//   {type:"error", error} · {type:"ended"}

// ClientFrame, client → server.
type ClientFrame struct {
	Type  string   `json:"type"` // send | answer | interrupt | mode | model
	Text  string   `json:"text,omitempty"`
	Files []string `json:"files,omitempty"` // with send: paths from POST /uploads
	Mode  string   `json:"mode,omitempty"`
	Model string   `json:"model,omitempty"`
	Answer
}

// Run: one thread's live summary, for notifications and Live Activities.
type Run struct {
	Thread    string   `json:"thread"`
	Session   string   `json:"session"`
	Provider  Provider `json:"provider"`
	Cwd       string   `json:"cwd"`
	Title     string   `json:"title"`
	Phase     string   `json:"phase"` // working | waiting | finished | failed
	Detail    string   `json:"detail"`
	StartedAt int64    `json:"startedAt"` // ms, current or last turn
	EndedAt   int64    `json:"endedAt,omitempty"`
	Prompt    string   `json:"prompt,omitempty"` // waiting on this prompt id (permission/plan: notification actions)
	Kind      string   `json:"kind,omitempty"`   // its kind
	Done      int      `json:"done,omitempty"`   // tasks completed
	Total     int      `json:"total,omitempty"`  // tasks
}

type Command struct {
	Name string `json:"name"`
	Desc string `json:"desc"`
}

type Device struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Created  time.Time `json:"created"`
	LastSeen time.Time `json:"lastSeen"`
	// Encrypted: it talks end-to-end encrypted (paired with a key).
	Encrypted bool `json:"encrypted,omitempty"`
}

type Term struct {
	Name     string `json:"name"`
	Cwd      string `json:"cwd"`
	Attached bool   `json:"attached"` // also open in a terminal on the Mac
	Created  int64  `json:"created"`
}

type FileEntry struct {
	Name string `json:"name"`
	Dir  bool   `json:"dir"`
	Size int64  `json:"size"`
}

type FileContent struct {
	Path   string `json:"path"`
	Text   string `json:"text"`
	Binary bool   `json:"binary,omitempty"`
	Trunc  bool   `json:"truncated,omitempty"`
	Hash   string `json:"hash,omitempty"` // sha256 of the whole file (editable text only): PUT /files' base
}

type GitStatus struct {
	Branch   string      `json:"branch"`
	Upstream string      `json:"upstream,omitempty"`
	Ahead    int         `json:"ahead"`
	Worktree bool        `json:"worktree,omitempty"` // a Luther worktree (removable)
	Files    []GitChange `json:"files"`
}

type GitChange struct {
	Path   string `json:"path"`
	Status string `json:"status"` // porcelain XY, e.g. " M", "??", "A "
}

func ValidMode(m string) bool {
	return m == ModeAsk || m == ModeEdits || m == ModePlan || m == ModeFull
}

// Name: how the app and notifications call an agent.
func (p Provider) Name() string {
	switch p {
	case Claude:
		return "Claude"
	case Codex:
		return "Codex"
	case OpenCode:
		return "OpenCode"
	case Gemini:
		return "Gemini"
	case Cursor:
		return "Cursor"
	case Devin:
		return "Devin"
	}
	return string(p)
}

// Job: a scheduled agent run — a new thread in Cwd that gets Prompt, whenever
// Cron (5 fields, server local time) matches.
type Job struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Cron     string   `json:"cron"`
	Enabled  bool     `json:"enabled"`
	Provider Provider `json:"provider"`
	Cwd      string   `json:"cwd"`
	Prompt   string   `json:"prompt"`
	Mode     string   `json:"mode,omitempty"`
	Model    string   `json:"model,omitempty"`
	Worktree bool     `json:"worktree,omitempty"` // each run in its own worktree
	// Filled by the server:
	Next       int64  `json:"next,omitempty"`    // ms
	LastRun    int64  `json:"lastRun,omitempty"` // ms
	LastThread string `json:"lastThread,omitempty"`
	LastError  string `json:"lastError,omitempty"`
}

// Port: a TCP port something of yours listens on (a dev server, usually).
type Port struct {
	Port    int    `json:"port"`
	Command string `json:"command"`
	Cwd     string `json:"cwd,omitempty"`
}

// Version of luther serve, reported by /healthz and to Codex. Release builds
// set it: -ldflags "-X github.com/AJAmit17/luther/server/internal/protocol.Version=v0.2.0".
var Version = "0.1.0-dev"

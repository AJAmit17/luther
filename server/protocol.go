package main

import "time"

// Wire protocol between `luther serve` and the phone app. These types are the
// source of truth; app/src/lib/protocol.ts mirrors them (change both together).
//
// HTTP (JSON, bearer device token on everything except /healthz and POST /pair):
//   GET  /healthz                         → {ok, name, version}
//   POST /pair {code, name}               → {deviceId, token}       (one-time code from `luther pair`)
//   POST /pair/code                       → {code, expires}        (admin token only: the CLI)
//   GET  /devices · DELETE /devices/{id}  · POST /devices/push {token}
//   GET  /providers                       → [ProviderInfo]
//   GET  /models?provider=                → [string]
//   GET  /projects                        → [Project]
//   GET  /dirs?path=                      → [string] (folders under $HOME)
//   GET  /sessions?cwd=                   → [Session] (past conversations of every provider)
//   POST /threads OpenReq                 → {id}     (409: held by a CLI outside Luther)
//   GET  /threads                         → [ThreadInfo] (open threads)
//   DELETE /threads/{id}
//   GET  /threads/{id}/events  (WS)       → Frame stream; in: ClientFrame
//   GET  /commands?provider=&cwd=         → [Command]
//   GET  /terms · POST /terms {cwd} → {name} · DELETE /terms/{name}
//   GET  /terms/{name}/events  (WS)       → {type:"screen",ansi} | {type:"ended"}; in: {type:"size",cols,rows} | {type:"input",hex}
//   GET  /files?cwd=&path=                → FileEntry list (dir) or FileContent (file)
//   GET  /git/status?cwd= · GET /git/diff?cwd=&path= · POST /git/commit {cwd, message}

type Provider string

const (
	Claude Provider = "claude"
	Codex  Provider = "codex"
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
}

type OpenReq struct {
	Provider Provider `json:"provider"`
	Cwd      string   `json:"cwd"`
	Resume   string   `json:"resume,omitempty"` // native session id
	Fork     bool     `json:"fork,omitempty"`
	Move     bool     `json:"move,omitempty"` // stop the CLI holding it, then host it here
	Model    string   `json:"model,omitempty"`
	Mode     string   `json:"mode,omitempty"`
}

type ThreadInfo struct {
	ID string `json:"id"`
	State
	Title   string `json:"title"`
	Clients int    `json:"clients"`
}

// State of one open thread; sent in snapshot and on every change.
type State struct {
	Provider Provider `json:"provider"`
	Session  string   `json:"session"` // native id; changes on Claude's /clear
	Cwd      string   `json:"cwd"`
	Busy     bool     `json:"busy"`
	Activity string   `json:"activity"`
	Model    string   `json:"model"`
	Mode     string   `json:"mode"`
	Commands []string `json:"commands,omitempty"`
	Usage    *Usage   `json:"usage,omitempty"`
	Dup      bool     `json:"dup,omitempty"` // a CLI outside Luther also has it open
}

type Usage struct {
	InputTokens  int64   `json:"inputTokens"`
	OutputTokens int64   `json:"outputTokens"`
	CostUSD      float64 `json:"costUsd,omitempty"`
}

// Msg: one chat row.
type Msg struct {
	ID   string `json:"id"`
	Role string `json:"role"` // user | assistant | tool | system
	Text string `json:"text"`
	Tool string `json:"tool,omitempty"`
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

	priv any // provider-side data needed to answer
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
	Type  string `json:"type"` // send | answer | interrupt | mode | model
	Text  string `json:"text,omitempty"`
	Mode  string `json:"mode,omitempty"`
	Model string `json:"model,omitempty"`
	Answer
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
	Push     bool      `json:"push"`
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
}

type GitStatus struct {
	Branch string      `json:"branch"`
	Files  []GitChange `json:"files"`
}

type GitChange struct {
	Path   string `json:"path"`
	Status string `json:"status"` // porcelain XY, e.g. " M", "??", "A "
}

# Luther: plan & spec

Luther is a control plane for the coding agents on your Mac. The Mac keeps the files and runs the agents (Claude Code, Codex); your phone steers them from anywhere over your tailnet or a Cloudflare tunnel. Deliberately simple: one Mac-side server, one phone app.

Work rule: build phases 0–8 fully, then test end to end in phase 9. Tick a box only when its code is in.

## Architecture

```
phone (Expo app, TypeScript)
  ├─ route A: https://<mac>.<tailnet>.ts.net      (tailscale serve → 127.0.0.1:<port>)
  └─ route B: https://luther.<your-domain>         (cloudflared → 127.0.0.1:<port>)
Mac: `luther serve` (Go, one binary, launchd), listens on 127.0.0.1 only
  ├─ state: ~/.luther/config.json — port, routes, paired devices (history stays in each CLI's own store)
  ├─ orchestrator: one agent process per open thread → events → every connected phone
  │    ├─ claude adapter: `claude -p` stream-json (Claude Code's headless protocol)
  │    └─ codex adapter:  `codex app-server` JSON-RPC over stdio
  ├─ importer: ~/.claude/projects/*.jsonl, ~/.codex/sessions (read-only)
  ├─ workbench: PTY terminals, file tree, git status/diff
  └─ feed: WS /events — a Run summary per thread on every change → the app's local notifications + Live Activities
```

## Decisions

| Decision | Why |
|---|---|
| Go server, TypeScript app | User choice. One static binary on the Mac; the app stays Expo/React Native. |
| Drive the agents' own headless protocols, never screen-scrape | `claude -p --input-format stream-json …` and `codex app-server` are what the vendors' SDKs use: real streaming, structured approvals, interrupt, resume. |
| Agents run with the user's own CLI logins | Luther never handles provider credentials or API keys. |
| Bind 127.0.0.1 only; tailnet and Cloudflare are reverse proxies; bearer token on every route | One listener, one auth path. Both proxies arrive from localhost, so the server can't tell routes apart. |
| No hosted relay, no push service (for now) | Phones talk to the Mac directly over the tailnet or tunnel. Notifications are **local**: the Mac streams run events (WS `/events`), the app posts notifications and drives Live Activities; a background task replays `GET /runs` when iOS wakes the app (~15 min). Limit: a closed or long-suspended app hears late; instant delivery needs APNs (paid Apple account) — the Mac would send it directly, no third party. Free Apple team works: `withoutPush` drops the push entitlement. |
| App layout: routes in `src/app` are one-line re-exports; screens and UI in `src/components`; logic in `src/lib` (pure parts with `node --test`); iOS-only pieces as `.ios.ts` | Small, findable files; logic testable without a simulator. |
| iOS first: native stack toolbars/menus, SF Symbols, system colors | The user's phone is an iPhone. Android builds, but header actions (toolbars) are iOS-only for now. |
| Server = one Go package per feature (`server/internal/*`), each a deep module with a small interface + `Routes(mux, wrap)`; `internal/api` wires them | Locality: a feature's code, state and routes live together; packages are reusable and testable through their interface. The only real seam is `hub.Runtime` (Claude, Codex adapters). |
| No database: config + devices in a JSON file; projects and threads come from the CLIs' own session stores | Luther owns almost no state; duplicating history would drift from the CLIs. |
| Go structs are the wire-protocol source of truth; `app/src/lib/protocol.ts` mirrors them | Two languages, one small protocol. Keep both in the same change. |
| Codex wire types generated from `codex app-server generate-json-schema` | The protocol is large and versioned; generate, don't hand-write. |
| Reuse Burrow's Go engine (Claude stream-json, verified wire facts, session indexer, pairing, push) | Same author, already verified against the real CLI. |
| Never write to `~/.claude` or `~/.codex` | Those are the CLIs' stores; Luther only reads them. |

## Phases

### Phase 0: Scaffold
- [x] Repo `AJAmit17/luther` (private), `server/` Go module, `app/` Expo (SDK 58, expo-router, TypeScript)
- [x] `docs/PLAN.md`, `CLAUDE.md`, `.gitignore`

### Phase 1: Protocol
- [x] Concepts: environment (the Mac), project (a folder), thread (a conversation with one provider), turn, message, tool call, approval, question, plan, provider
- [x] HTTP API (JSON); one WebSocket per open thread (snapshot, then deltas) and per terminal
- [x] Go types in `server/protocol.go`; mirror in `app/src/lib/protocol.ts`

### Phase 2: Server core
- [x] HTTP + WS server on 127.0.0.1; config in `~/.luther/config.json` (0600)
- [x] Pairing: `luther pair` gets a one-time code (admin token) → QR; phone trades it for a per-device token; list and revoke devices
- [x] Browse folders under `$HOME` (projects themselves are derived from sessions, phase 4)
- [x] Login-shell PATH and clean env so `claude` / `codex` are found under launchd

### Phase 3: Agent orchestration
- [x] `Runtime` interface (`hub.go`): send, interrupt, answer, set mode, set model, stop; the hub keeps state, messages, draft, prompts and fans out to every client
- [x] Claude runtime (`claude.go`): one `claude -p` stream-json per thread — approvals/questions/plans, `/clear` follow, fork via `--session-id`, one-writer rule (409 + move), dup warning
- [x] Codex runtime (`codex.go`): one shared `codex app-server` hosting every Codex thread, routed by `threadId`; start/resume/fork, turn start/steer/interrupt, command/file/permission approvals, user-input questions; mode = approval policy + sandbox per turn
- [x] Orchestration: many threads at once; Claude queues sends while busy, Codex steers the running turn; first answer wins across devices; idle stop after 30 min unwatched
- [x] Normalized events: text deltas, tool rows, approvals, questions, plans, turn end with usage (and cost for Claude), errors

### Phase 4: Existing sessions
- [x] Claude sessions from `~/.claude/projects/*/*.jsonl` (cwd from records, stat-cached); Codex threads from the app-server's `thread/list` (no file parsing)
- [x] Projects = folders those sessions ran in; open = resume under the original session id
- [x] Rescanned on every request, so terminal-started sessions appear without an import step

### Phase 5: Workbench
- [x] Terminals: shells in tmux on a private socket (`tmux -L luther`) — survive disconnects, attachable on the Mac; rendered pane (ANSI) to the phone, raw bytes back
- [x] Files: tree + read-only viewer (512 KB cap), confined to the project, symlink escapes refused
- [x] Git: status, working-tree diff vs HEAD (untracked files included), commit all

### Phase 6: Networking & push
- [x] `luther tailscale [--https N]`: `tailscale serve` to the local port; refuses a port already proxied elsewhere unless `--force`
- [x] `luther tunnel`: prints the Cloudflare steps; with `--url --id` records the route and writes `~/.cloudflared/luther.yml` (Access service token headers are sent by the app)
- [x] App: several Macs, each with ordered routes; first route that answers wins; a failed request or dropped socket re-picks; "Prefer" reorders
- [x] Server: a `Run` per thread (working / waiting / finished / failed, detail, timings) published on WS `/events`; `GET /runs` for background refresh; `POST /threads/{id}/interrupt`
- [x] App: local notifications for asks and for failed or ≥ 20 s turns (`runs.ts` decides, tested); Live Activity per running thread with Stop (`expo-widgets`); background refresh (`expo-background-task`); a tap switches to the Mac that sent it and opens (or resumes) the thread
- [x] Build: `withoutPush` (free team can sign), `withSceneLifecycle` (iOS 27 launch), `NSSupportsLiveActivities`

### Phase 7: App
- [x] Pair (QR / paste), Mac switcher, settings: routes, Cloudflare Access token, devices + revoke, forget
- [x] Home: running threads and terminals, then projects; project: every conversation (Claude + Codex) with provider badge; new-thread sheet (agent, model, permission mode); folder browser
- [x] Thread: streamed markdown, tool rows, approval / question / plan cards (haptics), Stop, `/` commands (Claude), queue (Claude) or steer (Codex) while busy, mode/model menu, usage
- [x] Terminal (rendered ANSI, key bar with sticky Ctrl), files (tree + viewer), changes (git status, diffs, commit all)

### Phase 8: `luther` CLI
- [x] `serve`, `pair` (QR: name, routes, one-time code), `tailscale`, `tunnel`, `service install|uninstall` (LaunchAgents `dev.luther.server` and `dev.luther.tunnel`), `doctor` (CLIs, server, each route, devices); logs in `~/.luther`

### Phase 9: P0 product gaps
- [x] Server packages (see decision) — `go list` shows a clean DAG
- [x] Approve / deny / reply from the notification: Run carries the waiting prompt; `POST /threads/{id}/answer`; app notification category with actions (approve needs unlock)
- [x] attachments — `POST /uploads` → path; Claude gets images as image blocks, Codex as `localImage`; other files as paths · [x] app picker + upload
- [x] parallel agents in git worktrees — `OpenReq.worktree` → `~/.luther/worktrees/<repo>-<id>` on `luther/<id>`; sessions fold into their project; `DELETE /git/worktree` · [x] app toggle + badges
- [x] per-turn checkpoints — tree before/after each turn via a throwaway index; `GET …/turns`, diff, revert · [x] app turn list, diff, revert
- [x] task progress — Claude `TodoWrite`, Codex `turn/plan/updated` → `State.tasks`, Run done/total · [x] app task list + Live Activity count
- [x] rename / pin / archive (`PATCH /sessions/…`, Luther-side `sessions.json`), search (`GET /sessions?q=`) · [x] app
- [x] push + PR (`POST /git/push`, `POST /git/pr` via `gh`) · [x] app

### Phase 10: End-to-end tests
- [ ] Pair over tailnet and over Cloudflare
- [ ] Claude thread: chat, approval, question, plan, Stop, model/mode switch
- [ ] Codex thread: the same
- [ ] Resume a terminal-started Claude and Codex session from the phone; the CLI's own resume sees the new turn
- [ ] Two phones on one thread: both stream; first approval wins
- [ ] Terminal, files, diff
- [ ] Push while the app is closed; tap opens the thread
- [ ] Mac reboot: service comes back; phone reconnects

### Phase 11: Publish (later)
- [ ] README, license choice, install script, TestFlight (push on iOS needs a paid Apple account)

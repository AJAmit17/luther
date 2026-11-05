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
  └─ push: Expo push service → phones
```

## Decisions

| Decision | Why |
|---|---|
| Go server, TypeScript app | User choice. One static binary on the Mac; the app stays Expo/React Native. |
| Drive the agents' own headless protocols, never screen-scrape | `claude -p --input-format stream-json …` and `codex app-server` are what the vendors' SDKs use: real streaming, structured approvals, interrupt, resume. |
| Agents run with the user's own CLI logins | Luther never handles provider credentials or API keys. |
| Bind 127.0.0.1 only; tailnet and Cloudflare are reverse proxies; bearer token on every route | One listener, one auth path. Both proxies arrive from localhost, so the server can't tell routes apart. |
| No hosted relay in v1 | Phones talk to the Mac directly over the tailnet or tunnel. Luther pushes from the Mac via Expo; a small hosted relay for discovery and offline push is optional later. |
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
- [ ] `luther tailscale`: set up `tailscale serve` to the local port
- [ ] Cloudflare: `cloudflared` config template + optional Access service token headers
- [ ] App: multiple routes per Mac, try in order, fall back, re-check earlier routes on network change
- [ ] Push via Expo on approval needed / long turn done; tap opens the thread

### Phase 7: App
- [ ] Pair (QR / paste), Macs list, route settings
- [ ] Projects → threads (provider badge, live/busy), new thread (provider, model, mode)
- [ ] Thread: streamed markdown, tool rows, approval / question / plan cards, Stop, `/` commands, model/mode menu
- [ ] Diff, terminal (native renderer, key bar), files screens
- [ ] Devices & revoke; push registration and deep links

### Phase 8: `luther` CLI
- [ ] `serve`, `pair`, `service install|uninstall` (launchd LaunchAgent), `doctor` (finds claude/codex, checks logins, routes), logs in `~/.luther`

### Phase 9: End-to-end tests
- [ ] Pair over tailnet and over Cloudflare
- [ ] Claude thread: chat, approval, question, plan, Stop, model/mode switch
- [ ] Codex thread: the same
- [ ] Resume a terminal-started Claude and Codex session from the phone; the CLI's own resume sees the new turn
- [ ] Two phones on one thread: both stream; first approval wins
- [ ] Terminal, files, diff
- [ ] Push while the app is closed; tap opens the thread
- [ ] Mac reboot: service comes back; phone reconnects

### Phase 10: Publish (later)
- [ ] README, license choice, install script, TestFlight (push on iOS needs a paid Apple account)

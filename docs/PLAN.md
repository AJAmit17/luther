# Luther: plan & spec

Luther is a control plane for the coding agents on your Mac. The Mac keeps the files and runs the agents (Claude Code, Codex); your phone steers them from anywhere over your tailnet or a Cloudflare tunnel. Inspired by [t3code](https://github.com/pingdotgg/t3code) (MIT), deliberately simpler: one Mac-side server, one phone app.

Work rule: build phases 0–8 fully, then test end to end in phase 9. Tick a box only when its code is in.

## Architecture

```
phone (Expo app, TypeScript)
  ├─ route A: https://<mac>.<tailnet>.ts.net      (tailscale serve → 127.0.0.1:<port>)
  └─ route B: https://luther.<your-domain>         (cloudflared → 127.0.0.1:<port>)
Mac: `luther serve` (Go, one binary, launchd), listens on 127.0.0.1 only
  ├─ store: SQLite — projects, threads, event log, devices
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
| No hosted relay in v1 | t3code's relay (T3 Connect) is a hosted service for accounts, discovery and push; the hot path is already direct. Luther pushes from the Mac via Expo; a Worker relay is optional later. |
| Go structs are the wire-protocol source of truth; `app/src/lib/protocol.ts` mirrors them | Two languages, one small protocol. Keep both in the same change. |
| Codex wire types generated from `codex app-server generate-json-schema` | The protocol is large and versioned; generate, don't hand-write. |
| Reuse: Burrow's Go engine (Claude stream-json, verified wire facts, session indexer, pairing, push) and t3code's designs (adapter split, session import, route fallback) | Port logic, not frameworks. Ported t3code code keeps its MIT notice in `NOTICE`. |
| Never write to `~/.claude` or `~/.codex` | Those are the CLIs' stores; Luther only reads them. |

## Phases

### Phase 0: Scaffold
- [x] Repo `AJAmit17/luther` (private), `server/` Go module, `app/` Expo (SDK 58, expo-router, TypeScript)
- [x] `docs/PLAN.md`, `CLAUDE.md`, `NOTICE`, `.gitignore`

### Phase 1: Protocol
- [ ] Concepts: environment (the Mac), project (a folder), thread (a conversation with one provider), turn, message, tool call, approval, question, plan, provider
- [ ] HTTP API (JSON) + one WebSocket per client: requests/replies, and a per-thread event stream (snapshot, then deltas)
- [ ] Go types in `server/protocol.go`; mirror in `app/src/lib/protocol.ts`

### Phase 2: Server core
- [ ] HTTP + WS server on 127.0.0.1; config in `~/.luther/config.json`
- [ ] Pairing: one-time code → QR; per-device token; list and revoke devices
- [ ] SQLite store (`modernc.org/sqlite`, pure Go): projects, threads, events, devices
- [ ] Projects: add a folder, list, browse folders under `$HOME`
- [ ] Login-shell PATH and clean env so `claude` / `codex` are found under launchd

### Phase 3: Agent orchestration
- [ ] Adapter interface: start/resume thread, send turn, interrupt, answer approval, set model, set permission mode, event stream, stop
- [ ] Claude adapter: port Burrow's `engine.go` (stream-json, `--permission-prompt-tool stdio`, approvals/questions/plans, `/clear` follow, fork via `--session-id`)
- [ ] Codex adapter: `codex app-server` JSON-RPC — initialize, thread start/resume, turn start, streaming items, approval requests, interrupt; Go types generated from its JSON Schema
- [ ] Orchestrator: one process per open thread, many at once; queue sends while busy; first answer wins across devices; idle stop; fan-out to every client
- [ ] Normalized events: text deltas, tool calls (start/end, output summary), approvals, questions, plans, turn end with usage/cost, errors

### Phase 4: Existing sessions
- [ ] Index Claude sessions (`~/.claude/projects/*/*.jsonl`, cwd from records) and Codex sessions (`~/.codex/sessions/**`)
- [ ] Show them per project; open = resume under the original session id
- [ ] Rescan on request (stat-cached) so terminal-started sessions appear without an import step

### Phase 5: Workbench
- [ ] Terminals: PTY per project (`creack/pty`), output streamed to the phone, keys back
- [ ] Files: tree + read-only viewer, path-confined to the project
- [ ] Git: status, per-turn diff, commit

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

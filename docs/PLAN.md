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
| Visual identity: Relay mark, mineral neutrals, deep teal / pale sea glass | User-approved direction. `app/src/lib/palette.ts` owns semantic colors; `scripts/generate-brand.swift` generates repo/mobile artwork. Filled actions use `onAccent`; attention remains distinct from the brand. |

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

### Phase 9b: P1 differentiators
- [x] Dev-server preview — `GET /ports` (lsof: your listeners, project folders first); `POST /previews {port}` → one-time `/p/<token>/` path; opening it sets a cookie and redirects to `/`; cookie-bearing requests no route claims are proxied to `localhost:<port>` (Host rewritten, WebSockets pass). App: Preview screen → Safari view (`expo-web-browser`). Limits: app paths colliding with Luther's routes (`/files`, `/events`…) reach Luther; a tunnel behind Cloudflare Access blocks the browser (no service-token headers)
- [x] Voice — hold the mic (empty composer) to talk; iOS on-device speech (`expo-speech-recognition`); sent on release
- [x] Widgets (`AgentsWidget` medium/large: running threads + projects; `SendWidget` small/lock screen), quick actions (`expo-quick-actions`), `luther://send?text=&cwd=&provider=` — Shortcuts/Siri/Share Sheet go through a user-made Shortcut opening that link (no App Intents / share extension: native targets for no gain yet)
- [x] Usage — package `usage` (`~/.luther/usage.json`); Claude `rate_limit_event` (`unifiedWindows`, verified 2.1.318), Codex `account/rateLimits/read|updated`; `GET /usage`; Settings → Usage bars
- [x] Subagents — `Msg.parent`: Claude steps with `parent_tool_use_id` (Task/Agent call row id = its tool_use id), activity names the subagent; Codex `collabAgentToolCall` rows. App folds steps under the call
- [x] More agents over ACP — package `acp` (OpenCode `opencode acp`, Gemini `gemini --acp`, Cursor `cursor-agent|agent acp`), one shared process per agent; package `rpc` now shared with Codex. Verified on OpenCode 1.18: initialize, `session/new` (model/mode config options), `session/list`, `session/load` replaying history, plan mode. Not verified: a model turn (key expired here), permission asks, Gemini, Cursor. Luther enforces edits/full by auto-approving; plan switches the agent's own plan mode
- [x] Instant lists — `useLoad(…, cache)` keeps each list's last answer per Mac on disk (`expo-file-system`); home, project, usage, send

### Phase 9c: Later items (APNs, iPad and Android deferred; MCP and skills editing deferred)
- [x] End-to-end encryption — packages `seal` (X25519 + HKDF-SHA256 + AES-256-GCM, stdlib) and `e2e` (POST /e sealed request → re-dispatched with an internal token; /e/ws sealed frames bridged to the local socket); pairing v2 seals the code to the key in the QR. Boxes bound by aad (req, res:<n>, ws>:<n>:<seq>, ws<:…); 2-minute window + seen-id replay refusal. Keyed phones' plain requests via Cloudflare (Cf-Ray) are refused. App `lib/e2e.ts` on @noble; one test vector pins both sides. Not covered: the dev-server preview (a browser can't seal), and no forward secrecy (static keys)
- [x] Remote hosts over SSH — package `remote`: `ssh -L` forwards kept up with backoff, relay at `/r/<name>/…`; `luther remote add|pair|list|remove`; Linux `luther service install` (systemd user unit). Relay tested with a stand-in; the ssh leg isn't (Remote Login is off on the dev Mac)
- [x] Scheduled runs — package `schedule` (cron parser with tests, minute ticker, run now, last result); app Schedules list + editor with presets
- [x] Project instruction files — `PUT /files` with a base hash (409 on a concurrent change, symlink-escape safe, tested); app Instructions screen and an editor for any text file. User-level files under ~/.claude and ~/.codex stay read-only
- [x] One-line install — `install.sh` (release download with checksum, or source build), `Formula/luther.rb` (tap from this repo), `scripts/build-release.sh` + `.github/workflows/release.yml` on `v*` tags. Not run yet: a real release, a brew install

### Phase 9d: Daily-driver improvements
- [x] Background lifecycle: `luther start|stop|status`; start returns the terminal immediately, is idempotent, and uses launchd (systemd user services on Linux). On-demand start is separate from install-at-login. Stop unloads the managed server; no PID-file signalling. macOS idle-sleep prevention follows the server lifetime on battery and AC; closing the lid is not overridden.
- [x] Thread header: provider logo + name; composer contains model and permission controls, not a duplicate provider chip.
- [x] Devin CLI through `devin acp`: discovery, sessions/resume, streaming, model configuration, permissions, commands, cancellation. Credentials stay with the CLI. Its native Ask is read-only; edits/plan/full map to accept-edits/plan/bypass. Verified against the installed CLI: initialize, session/new, model/mode options, session/close (no model turn); a fake ACP peer tests permissions, models, modes, streaming, usage and cancellation.
- [x] Multi-repository workspaces: discover repositories below a non-git chat folder; select a repository before diff/commit/push/PR/worktree actions. Never initialize the parent or apply a mutation to several repositories implicitly. Scan at most four levels / 20,000 entries, skip hidden/dependency/build folders and do not follow child symlinks; gitfiles/worktrees are supported. A chat in a repository subfolder selects its repository root for git actions.
- [x] Dedicated Usage tab: plan limits plus 7/30/90-day daily token charts, input/output/cache breakdown, provider/model totals and reported costs. Read Claude/Codex transcripts, including terminal-started sessions, read-only and stat-cached; retain reported ACP prompt usage in Luther's own store. Claude reported turn costs are separate receipts, not duplicate token entries or assumed per-model costs. Deduplicate streamed Claude message records and cumulative Codex counters. Missing costs/usage remain explicitly unavailable; ACP context occupancy is not token burn.
- [x] Automated regression tests, `go test -race ./...`, Go vet/build, app tests/typecheck/lint; iOS bundle export; isolated-home native-server smoke (auth, history, repositories, idempotent start, caffeinate PID); Linux amd64 cross-build. Device, installed launchd/systemd, real agent-turn and network checks remain explicitly separate.
- [x] Dynamic token units in Usage and thread summaries: shared, deterministic base-1,000 scaling (K/M/B/T), up to two decimals, including rounding across unit boundaries. One billion is 1,000 million; 100 million stays 100M. Do not depend on Intl compact notation: Hermes iOS ignores it. Usage defaults to Compact and offers a persisted Compact/Full toggle that controls totals, daily details, cache counts and provider/model rows; Full preserves exact grouped counts.
- [x] Daily chart scroll discovery: subtle Swipe/arrow cue and native horizontal scroll indicator when measured content overflows; no extra cue when all days fit.
- [x] Publish the daily-driver feature branch and PR; PR #1 merged into `main` as `2a717de`.

### Phase 9e: Terminal CLI experience
- [x] Cobra command tree: grouped help/examples, strict argument/flag validation, typo suggestions, bash/zsh/fish/PowerShell completion. Help/version/completion do not initialize config or start the server.
- [x] Bare `luther` shows a read-only overview and suggested next commands; foreground operation is explicitly `luther serve` (service managers already use it).
- [x] Lip Gloss presentation: restrained orange branding, responsive terminal status panel, pairing instructions and diagnostic rows. Plain piped/dumb-terminal output; `NO_COLOR` and `--no-color`; preserve undecorated `pair --json` and add safe `status --json` without credentials.
- [x] Preserve all existing lifecycle, route, service and remote commands; Cobra owns parsing, feature handlers receive typed values. Keep runtime behavior and the phone wire protocol unchanged. `config.Read` serves read-only commands without generating or saving keys.
- [x] Regression tests for side-effect-free help/validation, compatibility/JSON, typed route/remote flags and terminal rendering; Go race tests, vet/build, isolated binary/PTY smoke (true color, no-color, narrow/dumb terminals, read-only overview, status JSON, explicit serve), bash/zsh completion syntax and Linux amd64 cross-build. Live service-manager mutations, new real SSH provisioning and physical QR rescans were not exercised in this CLI-only pass.

### Phase 9f: Relay identity and project documentation
- [x] Approved Relay geometry: reusable vectors, outlined light/dark wordmarks, social artwork, mobile bitmaps, and Icon Composer source. Discard the visual experiments.
- [x] Shared Relay palette without screen-layout changes; readable filled-action foregrounds and separate attention states. Match widget and Live Activity colors.
- [x] Detailed README, native-only iPhone setup, contribution guide, contributor credit, and reproducible artwork instructions.
- [x] Apache-2.0 with project `NOTICE`, approved by the maintainer. Preserve project notices in server archives, installer and Homebrew; align app metadata and contribution terms. No mandatory UI badge or added advertising condition.
- [x] Verification: 21 app tests, typecheck/lint, Go race tests/vet/build, 66 solid-palette contrast pairs, repeatable asset generation, Apple asset compilation and compiled-silhouette check, Android safe-circle check, and isolated notice-copy/archive checks. Full native app rebuild, phone installation, and public release remain separate.

### Phase 9g: Native Android build and phone refresh
- [x] Generate Android from the shared Expo SDK 58 app and build a standalone arm64 Release APK without a Metro development server. Signature verified; JavaScript embedded; API 24+, target API 36, non-debuggable. Build commands are in `app/README.md`.
- [x] Install and launch on the USB-connected Motorola Edge 50 Pro with `adb`; pairing screen rendered, app process remained alive, and app-UID startup error/fatal logs were empty. Local test signing is not production/Play Store signing.
- [x] Build the current Relay-branded iOS app as a signed native Release; verify its signature and install on the connected iPhone with `devicectl`.
- [ ] Confirm iPhone launch after unlocking; installation succeeded, but automatic launch was blocked by the device lock.
- [x] App typecheck/lint, all 21 tests, and Go vet/build pass. Shared application code is unchanged; native folders/build outputs remain ignored.
- [ ] Android pairing and agent-turn workflows; native Android equivalents for iOS-only symbols/toolbars/widgets remain separate from this build-only pass.

### Phase 9h: Android presentation
- [ ] Align Android content, native stack headers, tab bar, and system bars with the saved System/Light/Dark appearance. Preserve iOS dynamic colors and Relay identity.
- [ ] Render Android Material Symbols through the installed Expo Symbols module; retain SF images on iOS.
- [ ] Constrain menu-wrapped list rows; use Android typography, tonal cards, and comfortable composer controls.
- [ ] Rebuild/install the standalone Android Release; verify Home, Settings, chat, and appearance changes through scrcpy/device captures. Initial screenshot probe failed with a 17.04:1 header/content contrast.

### Phase 9i: Agents that show and delegate
- [x] Luther's tool server for agents — package `tools`: `luther mcp` (hidden) is MCP over stdio, relaying `tools/list`/`tools/call` to `GET/POST /agent-tools` with a per-thread token (`LUTHER_TOOL_TOKEN`); the routes take it only from this Mac (`auth.Direct`). Every thread gets it: Claude `--mcp-config <file>` (`~/.luther/mcp/<session>.json`, 0600, removed when it exits: the token stays off the command line) + `--allowedTools mcp__luther` (`MCP_TOOL_TIMEOUT` 31 min), Codex per-thread `config` on start/resume/fork (`mcp_servers.luther`, `default_tools_approval_mode = "approve"`, `tool_timeout_sec`; shape verified against codex 0.165 app-server, which started it per thread), ACP `mcpServers` on new/load/fork (stdio, env as a list)
- [x] HTML artifacts — package `artifacts`: `show_artifact {title, path | html}`; a project `.html/.htm` (inside the thread's folder, symlink escapes refused) or the page itself (kept in `~/.luther/artifacts`, so read-only agents can show one), ≤ 5 MB; the card is `Msg{role: "artifact"}` with id = hash of the arguments (Claude's history replays it with the same id; `AddOnce` dedupes the live one). `POST /artifacts/{id}/link` → `/a/<token>/` for 30 min, read fresh on every load, served `Content-Security-Policy: sandbox allow-scripts` (opaque origin: no cookies, storage, forms, popups), no-store, no-referrer; index pruned after 30 days. App: artifact card → Safari sheet (`expo-web-browser`, like Preview). Limits: like Preview, a browser can't seal, so the page travels over the route's TLS only; Codex/ACP history doesn't rebuild cards (live only)
- [x] Change walkthroughs — `POST /walkthroughs {cwd | thread+turn, provider?}`: the working tree (`workspace.WorkingDiff`, untracked files included) or a turn's diff, lockfiles/minified/maps/snapshots dropped, ≤ 120 KB in the prompt; a new Ask-mode thread in the repo told to show one self-contained page via `show_artifact` with html and edit nothing. App: ✨ on the all-changes and turn diffs opens the thread
- [x] Agents running agents — `start_thread {agent | template, prompt, cwd?, model?, mode?, worktree?}`, `send_message`, `wait_for_thread {timeout_seconds ≤ 1800}` (finished / waiting for you / failed / ended / still working, with the last reply). Only threads the caller started; unknown modes refused; a child never gets more access than its parent (plan < ask < edits < full); "Started by …" notice in the child; a just-sent message counts as working until its turn starts
- [x] Role templates — package `templates`: `~/.luther/templates/<name>.md` (front matter `description`, `agent`, `model`, `mode`; body = instructions) plus a built-in read-only `reviewer`; a file replaces a built-in. `GET /templates`; `OpenReq.template` fills provider/model/mode and prefixes the first message. App: Role picker on the new-thread sheet
- [x] Tests: tool auth (token, tunnel refusal), `show_artifact` guards, children-only and no-escalation, artifact links/CSP/reload, templates parsing, diff cleaning, full router registration; Go race/vet, app typecheck/lint/22 tests. Not run yet: a real agent calling the tools (Claude, Codex, ACP), the Safari sheet on a phone

### Phase 9j: Work that runs without you
- [x] Session goals — `State.goal`; `POST/DELETE /threads/{id}/goal` (and `goal`/`goal_stop` frames). After each turn the hub asks the judge (package `goal`: a one-off, tool-less, unsaved call — `claude -p --no-session-persistence --tools "" --model haiku --json-schema`, or `codex exec --ephemeral -s read-only --output-schema` for Codex threads or without Claude) with only the objective and the last reply → done / blocked / continue + reason. Continue sends the next round with what's missing; done, two blocked in a row, the round limit (default 10, at most 50), a failed turn, a judge error or Stop end it, with a notice in the thread. A verdict that lands after Stop is dropped (generation counter). App: "Work toward a goal" sheet, goal panel with Stop. Not done: a token budget (only Claude reports cost per turn)
- [x] Multi-run across agents — `POST /compares {cwd, prompt, mode, runs}` (2–5) opens each in a new worktree at once; `GET /compares[?cwd]`, `GET /compares/{id}` with live status, last reply and diff size (`workspace.Changes`, new files included via intent-to-add); keep = `workspace.CarryOver` (the worktree's patch applied to your checkout uncommitted, only if it applies cleanly; refused while the run works); combine = a new Edits thread in your checkout told to compare the worktrees and merge the best. `~/.luther/compares.json`, last 30. App: project → Compare agents, a sheet to start, a detail screen (Open, Diff, Keep, Combine)
- [x] Safer schedules — runs are unattended (`OpenReq.Unattended`): every approval, question or plan is declined with a note (questions answered "decide yourself"), so a run never stalls; Claude also gets `--disallowedTools AskUserQuestion` and `Bash(...)` deny rules for `protocol.Blocked` (sudo, force-push, reset --hard, clean, rm -rf /, shutdown…), which hold in every mode. `Job.runs`: the last 20 with status, the agent's last reply as the report, and read flags (`POST /schedules/{id}/read`); runs cut off by a restart are marked failed. App: Reports screen (open a run's conversation), "n new reports", unread badge on the Schedules tab, starter prompts, new schedules default to Edits in their own worktree. Not done: deny rules for Codex and ACP agents (Codex's sandbox still applies)
- [x] Survive restarts — package `restore`: threads working or waiting are saved to `~/.luther/running.json` every 5 s when they change (and every 10 min regardless) and on SIGTERM/SIGINT; at start, once listening, each one under two hours old is resumed with its agent's own resume and told to carry on
- [x] Worktrees reachable from the phone — `~/.luther/worktrees` is no longer private (files, diff, git status of a worktree thread work); the rest of `~/.luther` stays private, also through links planted in a worktree
- [x] Tests: goal loop (continue → done, limit, blocked twice, judge error, failed turn, stop while judging), unattended declines, scheduled run recorded and read, restore selection, carry-over with real git (clash leaves the checkout untouched, new files carried), worktree confinement, judge answer parsing, router registration. Not run yet: a real judge call, a real restart, a real comparison

### Phase 9k: Workbench depth
- [x] Git — `GET /git/branches` (local branches by last commit, stashes), `POST /git/checkout` (`check-ref-format`, never a flag; git refuses to overwrite changes), stash push (untracked included) / apply / pop / drop (refs `stash@{n}` only), `GitStatus.operation` (merge, rebase, cherry-pick, revert from the git dir) and `POST /git/abort`; conflicts handed to a new Claude thread (resolve, stage, don't commit). `POST /git/message`: a commit message from the diff (package `oneshot`, now shared with the goal judge). Worktrees: `GET /git/worktrees`, `POST /git/worktree/bring` (`CarryOver` into the main checkout), remove with its `luther/` branch (`branch=1`; the main checkout is looked up before the folder goes). App: conflict banner (resolve with an agent, abort), ✨ commit message, Branches and stashes screen, Worktrees screen, bring/remove in a worktree's Changes
- [x] Composer — `@` searches project files (`GET /files/search`: git's file list or a bounded walk; name prefix > name > path > letters in order); `!command` runs one command in the project through your login shell (`POST /shell`, 2 minutes, last 64 KB) and offers its output to the agent; edit the last message (back into the composer, optionally undoing that turn's files; the earlier exchange stays: headless Claude can't rewind); fork (`OpenReq.fork`); compact (`compact` frame: Claude's `/compact`, Codex `thread/compact/start`; others say they can't)
- [x] Files — `POST /files/mkdir`, `/files/rename`, `/files/upload` (≤ 25 MB, never over a file unless `replace=1`), `DELETE /files` (moved into the Trash folder, renamed if taken), `GET /files/raw` (pictures ≤ 10 MB); every write path stays in the project, never `.git`, also through links (`target`). App: + menu (new file, new folder, upload photos or files), long-press rename / move to Trash, syntax highlighting (`lib/highlight.ts`, files ≤ 80 KB), Markdown preview with a source toggle, picture preview
- [x] Read-aloud — long-press a reply: the phone's own voice (`expo-speech`), Markdown read as speech (`lib/speech-text.ts`: code blocks named, links and marks dropped); long-press again stops
- [x] Health and logs — `GET /health` (version, uptime, each agent: installed, version, process up, open threads), `GET /logs` (end of `serve.log`), `POST /agents/{id}/restart` (Codex/ACP: the shared process; Claude: its threads). App: Settings → Health, Server log
- [ ] Deferred: project actions (`.luther/project.json`) and secrets in the Keychain
- [x] Tests: file operations and their confinement, mention ranking, branches/stash/abort against a real merge conflict, shell and log tail, highlighter, speech text; Go race/vet, app typecheck/lint/27 tests. Not run yet: a real commit-message call, the new screens on a phone

### Phase 9l: More agents (Phase D, next)
- [ ] GitHub Copilot CLI (#6), Kimi Code CLI (#11), Qwen Code (#12), Factory Droid (#13), Grok CLI (#14), Amp (#15): each over ACP where it has it; see the issues

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
- [x] Licence choice: Apache-2.0 with attribution in `NOTICE`.
- [ ] First tagged release and verified installation.
- [ ] TestFlight (push on iOS needs a paid Apple account).

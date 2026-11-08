<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/wordmark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/brand/wordmark-light.svg">
    <img src="assets/brand/wordmark-light.svg" alt="Luther" width="300">
  </picture>
</p>

<p align="center"><strong>Your agents. Your Mac. Anywhere.</strong></p>
<p align="center">A self-hosted control plane for coding agents, steered from your iPhone or Android phone.</p>
<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#agents">Agents</a> ·
  <a href="#build-the-iphone-app">iPhone app</a> ·
  <a href="app/README.md#build-the-android-apk">Android app</a> ·
  <a href="#security-and-trust">Security</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="LICENSE">Apache 2.0</a>
</p>

---

Luther connects your phone to the coding agents running on your own machine. Start a task, leave your desk, review its progress, answer an approval, or open a terminal without moving the repository or the agent's login to a hosted service.

The Mac keeps the files and runs the agents. The phone is the controller. Reach the Mac through **Tailscale Funnel**, a **Cloudflare quick tunnel** (no account), your own **Cloudflare Tunnel** domain, or plain **Tailscale**; reach further machines through **SSH**.

Agents: **Claude Code**, **Codex**, **Devin**, **OpenCode**, **Oh My Pi**, **Gemini CLI** and **Cursor**.

**Status:** pre-release. The server runs on macOS (primary) and Linux. The iPhone and Android apps are built from source and installed as native apps (signed Release build on iPhone, standalone APK on Android). There is no published App Store/TestFlight installation flow yet. Device/network end-to-end checks and release work are tracked in [the project plan](docs/PLAN.md).

## What you can do

| Capability | What it means |
| --- | --- |
| Continue real agent sessions | Stream responses, switch permission modes, interrupt work, and resume supported sessions. |
| Pick the real model | Each agent's own model list with real names ("Opus 5.5", not "Default"), grouped and searchable when an agent offers hundreds. |
| Set the effort | Each agent's own effort levels (Low to Max, Ultra on some Codex models, thinking off on Oh My Pi) and its fast mode where the account has one. A session shows the effort it last ran at, also when it was set on the Mac. |
| Send photos | Take a photo or pick images and files; images show in the conversation, and large ones are shrunk before the agent sees them. |
| Stay in control | Answer permission requests, questions, and plans from the phone. Concurrent clients share a thread; the first accepted answer wins. |
| Work across repositories | Open a parent workspace containing several Git checkouts. Select the specific checkout before a Git mutation or worktree operation. |
| Inspect the work | Browse files, review changes and per-turn checkpoints, commit, push, and create pull requests using the Mac's own tools. |
| Use a persistent terminal | Open a tmux-backed terminal that can survive a phone disconnect and be attached to on the Mac. |
| See usage honestly | Daily 7/30/90-day token charts, input/output/cache breakdowns, provider/model totals, plan limits, and reported costs. Compact K/M/B/T or exact counts. |
| Reach other machines | Relay another Luther server through a maintained SSH forward instead of exposing that host directly. |
| See what agents make | An agent can show you an HTML page (a chart, a report, a walkthrough of its changes) as a card that opens on the phone. ✨ on any diff starts a walkthrough. |
| Hand work between agents | An agent can start another agent (Claude asks Codex for a review), send it messages and wait for its reply; you follow both threads. Start a thread in a role, like the built-in reviewer, or your own in `~/.luther/templates`. |
| Keep tasks moving | Schedule prompts, dictate messages, inspect local dev-server previews, and use widgets or Live Activities (iPhone). |

Luther invokes the providers' own CLIs. It does not replace their subscriptions, logins, limits, sandboxes, or permission models.

## How it works

```text
Phone (iPhone or Android)
  │   end-to-end encrypted on every route
  ├── Tailscale Funnel / Serve ───────┐
  ├── Cloudflare quick tunnel ────────┤
  └── Cloudflare named tunnel ────────┤
                                     ▼
                         Luther on 127.0.0.1
                         ├── agent CLI processes
                         ├── sessions, files, Git, terminals
                         └── SSH forward → another Luther server
```

- **One Go server** runs on the machine with your repositories.
- **One Expo/React Native app** controls it from iPhone or Android, with native controls on each (SF Symbols and menus on iOS, Material Symbols and bottom sheets on Android).
- **No Luther-hosted relay or database.** Provider CLIs retain their session histories; Luther owns configuration, device records, and supporting local state.
- **Existing agent logins stay on their machine.** Provider API keys do not need to be entered into the phone.

## Requirements

### Agent machine

- macOS, or Linux with a working systemd user session for background lifecycle commands.
- At least one supported agent CLI, installed and logged in as the user who runs Luther.
- Git for repository operations; tmux for terminals.
- One way in: Tailscale (Funnel, or Serve with Tailscale on the phone too), or `cloudflared` for a quick tunnel (no account), or an existing Cloudflare Tunnel.
- GitHub CLI (`gh`) logged in on the agent machine for pull-request creation.
- Go **1.26.10 or newer** when building from source, as specified in [`server/go.mod`](server/go.mod).

The agent process runs with the server user's permissions. Use an account and workspace you trust.

### iPhone build

A Mac with compatible Xcode, CocoaPods, Node **24.3+ within 24.x** or **26.x**, and Apple signing configured. Tests use Node's native TypeScript support. The app uses Expo **58**, React Native **0.88**, and React **19.3**. Use the lockfile rather than upgrading them independently.

### Android build

JDK **17**, the Android SDK (Build Tools 37, NDK 27.1, CMake 3.22), the same Node versions as above, and an arm64 phone with USB debugging enabled. Steps are in [Build the Android APK](app/README.md#build-the-android-apk).

## Quick start

### 1. Build the server

```sh
git clone https://github.com/AJAmit17/luther.git
cd luther/server
go build -o luther .
./luther version
```

The remaining examples assume `luther` is on your `PATH`. From the repository root, use `./server/luther` instead.

An installer is also available:

```sh
curl -fsSL https://raw.githubusercontent.com/AJAmit17/luther/main/install.sh | sh
```

It downloads a matching release and verifies its checksum, or falls back to a source build when no release is available. It defaults to `~/.local/bin`; `LUTHER_BIN` changes the destination and `LUTHER_VERSION` selects a tag. Private-repository downloads require appropriate GitHub access; never share or commit the token.

Project licence/attribution files shipped with the download are retained under `${XDG_DATA_HOME:-$HOME/.local/share}/luther`.

Homebrew support is scaffolded in [`Formula/luther.rb`](Formula/luther.rb), but the stable formula has a placeholder revision until a real release is published. For a source install before that release:

```sh
brew tap AJAmit17/luther https://github.com/AJAmit17/luther
brew install --HEAD luther
```

The installer, release workflow, and formula are not a claim that a tagged release has already been tested or published.

### 2. Start Luther and publish a route

```sh
luther doctor
luther start
luther funnel          # or: luther tunnel --quick
luther status
```

Pick one way for the phone to reach this Mac. Everything is end-to-end encrypted on all of them, and the phone needs nothing installed:

| Command | Needs on the Mac | Address |
|---|---|---|
| `luther funnel` | Tailscale, with Funnel allowed in the tailnet policy (the command prints the link if it isn't) | Stable: `https://<mac>.<tailnet>.ts.net:8443` |
| `luther tunnel --quick` | `cloudflared` (`brew install cloudflared`), no account | Random `https://….trycloudflare.com`; changes when cloudflared restarts (e.g. a reboot). A phone that still reaches the Mac picks the new one up by itself; otherwise run `luther pair` again. |
| `luther tunnel --url … --id …` | `cloudflared`, a Cloudflare account and your own domain (steps below) | Stable: `https://luther.<your-domain>` |
| `luther tailscale` | Tailscale, on the phone as well | Tailnet only |

`start` returns your terminal immediately. On macOS, `caffeinate` prevents idle sleep while the server runs, on battery or AC. It **does not override lid-close sleep**.

For a named Cloudflare tunnel on your own domain, run `luther tunnel` for setup instructions. After creating the tunnel and configuring credentials/DNS, register its real URL and ID:

```sh
luther tunnel --url https://luther.example.com --id <TUNNEL_UUID>
```

The example hostname is a placeholder. The command configures Luther's route and tunnel file; it does not create your Cloudflare account, DNS, or tunnel credentials. If using Cloudflare Access, configure its service-token headers in the app's route settings.

Once set up, `luther serve` keeps the tunnel running (and both Cloudflare tunnels outlive Luther's own restarts). If something else already runs `cloudflared` with `luther.yml`, such as the login service, Luther leaves that one alone. Use a hostname of its own: `route dns` adds a CNAME for it, which takes precedence over a wildcard record without changing it.

### 3. Install the app and pair

Build the [native iPhone app](#build-the-iphone-app) or the [local Android APK](app/README.md#build-the-android-apk), then:

```sh
luther pair
```

Scan the QR code **inside Luther**, or paste the pairing payload into its pairing screen. The code is short-lived and single-use; treat the QR and JSON payload as sensitive.

Pick a folder, select an installed agent, and send a task. A parent folder does not need to be a Git repository for its child repositories to be usable.

## Everyday commands

| Command | Purpose |
| --- | --- |
| `luther version` | Print the build version. |
| `luther` | Read-only overview and suggested commands. |
| `luther start` / `luther stop` | Start or stop the managed background server. |
| `luther status` | Show state, routes, and paired-device information. |
| `luther status --json` | Undecorated, credential-free status data. |
| `luther serve` | Explicit foreground mode, also used by service managers. |
| `luther pair` | Generate pairing instructions and a QR code. |
| `luther funnel` | Publish Luther with Tailscale Funnel: reachable from anywhere, no Tailscale on the phone. |
| `luther tunnel --quick` | Start a Cloudflare quick tunnel (no account); `--quick-off` stops it. |
| `luther tailscale` | Configure Tailscale Serve for the local listener (tailnet only). |
| `luther tunnel` | Show named Cloudflare tunnel setup instructions. |
| `luther doctor` | Diagnose installed tools, server, and routes. |
| `luther service install` / `uninstall` | Install or remove startup-at-login behavior. |
| `luther remote add\|pair\|list\|remove` | Manage SSH-relayed agent machines. |
| `luther completion bash\|zsh\|fish\|powershell` | Generate shell completion. |

Use `luther <command> --help` for arguments and examples. Styling is disabled for pipes and dumb terminals; `NO_COLOR=1` or `--no-color` also disables colors.

`start` is on-demand and opens every configured way in again (the tailnet route as Funnel or Serve, and both Cloudflare tunnels); `stop` closes them all: the tailnet route comes off Luther's port and both `cloudflared` processes end, while the named tunnel and its DNS record stay. A quick tunnel gets a new address on each start. `service install` separately enables startup at login. With the login service installed, `stop` stops it now but does not remove its next-login behavior. Logs are under `~/.luther/`, including `serve.log`.

### Other machines over SSH

Install Luther and the relevant CLIs on the remote host, then:

```sh
luther remote add devbox me@devbox.example.com
luther remote list
luther remote pair devbox
```

This uses key-based SSH and forwards the remote server through this Mac. The remote host does not need its own public route. Remote port and SSH options are documented by the command usage in [`server/internal/cli/remote.go`](server/internal/cli/remote.go). Removing the relay does not stop Luther on that host.

## Agents

| Agent | Integration | Important notes |
| --- | --- | --- |
| Claude Code | Headless stream-JSON CLI | Reads local session history; the agent's CLI retains ownership of it. |
| Codex | `codex app-server` over JSON-RPC | Lists/resumes sessions through the app-server protocol. |
| Devin CLI | `devin acp` | Uses the existing login. Native Ask is read-only; Luther preserves that meaning. |
| OpenCode | `opencode acp` | ACP capabilities determine models, modes, and session operations. |
| Gemini CLI | `gemini --acp` | Requires a CLI version exposing the ACP interface. |
| Cursor | `cursor-agent acp` or `agent acp` | Requires a compatible installed command. |
| Oh My Pi | `omp acp` | Lists the models of every provider it is set up with (often hundreds; the app makes them searchable). |

ACP adapters share a protocol, not a guarantee of identical capabilities. Models and permissions depend on the agent. Model lists come from the agents themselves (Claude's `initialize`, Codex's `model/list`, ACP's `session/new`) and are cached in `~/.luther/models.json`. `luther doctor` shows which agents are installed. Devin handshake/session/model/mode behavior has been checked; fake-peer tests cover protocol flows. Live model turns and all providers' real permission paths are not universally verified. See the [end-to-end checklist](docs/PLAN.md#phase-10-end-to-end-tests).

## Agent tools

Every thread Luther opens gets Luther's own tools, over MCP (`luther mcp`, started by the agent with a token for that thread):

| Tool | What it does |
| --- | --- |
| `show_artifact` | Shows an HTML page as a card in the thread: an `.html` file in the project (edit it, reopen the card) or the page itself. At most 5 MB. |
| `start_thread` | Starts another agent on a task, in this folder or another, optionally in a role and its own worktree. |
| `send_message`, `wait_for_thread` | Talk to a thread it started, and wait (up to 30 minutes) for its reply or for it to need you. |

An agent reaches only the threads it started, and a thread it starts never gets more access than its own (plan < ask < edits < full). Luther's tools don't ask for approval; what the started agents do still follows their own mode.

**Roles** are Markdown files in `~/.luther/templates/`:

```markdown
---
description: Writes tests for the change
agent: codex
mode: edits
---
Write tests for the uncommitted change. Cover the edge cases, run them, and fix what fails.
```

`agent`, `model` and `mode` are optional; the instructions go before the first message. A built-in `reviewer` (read-only) is there until a file of that name replaces it.

## Usage and notifications

Usage history combines readable Claude/Codex transcripts with explicit usage reported by ACP prompts run through Luther. Supported streamed/cumulative records are deduplicated. Agent context occupancy is not token consumption.

**Reported costs are not estimated bills or subscription charges.** Missing metrics stay unavailable; partial cost coverage is labeled. One billion is 1,000 million. The shared formatter handles K/M/B/T dynamically without relying on Hermes' compact `Intl` behavior.

Notifications and Live Activities depend on events the app can receive. Background refresh may replay run summaries when iOS wakes the app. **Instant closed-app remote push is not implemented.** Do not rely on a suspended or closed app receiving immediate notifications.

## Build the iPhone app

An installed Release app does not require a Metro server. Physical-device deployment uses **Xcode and `devicectl`**, not Expo Go or `expo run:*`.

```sh
cd app
npm ci
export APPLE_TEAM_ID=YOUR_APPLE_TEAM_ID
npx expo prebuild --platform ios --no-install
pod install --project-directory=ios
```

`prebuild` generates the native project from checked-in config/plugins; it does not run the app or start Metro. Use your own Apple team and, if needed, a bundle identifier registered to it. The current identifier is `dev.luther.app`.

Build a signed standalone Release:

```sh
xcodebuild \
  -workspace ios/Luther.xcworkspace \
  -scheme Luther \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath /tmp/luther-ios \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  build
```

List devices, replace `<DEVICE_ID>`, unlock the iPhone, and install/launch:

```sh
xcrun devicectl list devices
xcrun devicectl device install app \
  --device <DEVICE_ID> \
  /tmp/luther-ios/Build/Products/Release-iphoneos/Luther.app
xcrun devicectl device process launch --device <DEVICE_ID> dev.luther.app
```

If you changed the bundle identifier, use it for launch. Apple controls signing, entitlement availability, and free-team provisioning limits. The app omits the APNs entitlement so a free team can sign; Live Activities do not turn that into remote push.

## Security and trust

Luther can run commands and change files. Pair only devices and people you trust with that power.

- The server binds to **`127.0.0.1`**, not a public interface. Tailscale (Funnel or Serve) and Cloudflare tunnels proxy to it.
- Protected operations require authentication. Pairing uses a short-lived code; devices can be revoked in Settings.
- Key-paired phones seal API requests and event streams using X25519, HKDF-SHA256, and AES-256-GCM, with freshness/replay checks.
- Browser dev-server previews use a separate token/cookie proxy and are **not** covered by the sealed app protocol. Relays still see connection metadata. Static device/server keys do not provide forward secrecy.
- Provider-owned stores are read-only to Luther; it does not write configuration or credentials into `~/.claude` or `~/.codex`.
- File confinement and explicit repository selection reduce mistakes; they do not make an agent with full access safe against malicious instructions.

- A phone paired with a key only talks end-to-end encrypted: its bearer token sent in plain text is refused on every route, so a leaked token alone can't drive the Mac. Removing a phone closes its open sockets within seconds.
- The admin token (`~/.luther/config.json`) works only from the Mac itself, never through Tailscale, Cloudflare or another proxy.
- Luther's file, git and terminal routes stay inside your home folder, also through symlinks, and never reach `~/.luther`, `~/.ssh`, `~/.gnupg`, `~/.aws` or your keychains. An agent you run still acts with your own rights.
- A preview link opens once and lasts an hour, and only for a dev server listening now on port 1024 or higher.
- An agent's HTML page opens through a random link that lasts 30 minutes. It is served sandboxed (an opaque origin: scripts run, but no cookies, storage, forms or popups), so a page can't act as your phone or reach Luther. Like previews, it isn't covered by the sealed app protocol.
- The agents' tool server takes its per-thread token only from the Mac itself.
- Unauthenticated callers get `{ok: true}` from `/healthz` and nothing else.

### What `~/.luther` keeps

| File | What | How long |
|---|---|---|
| `config.json` | Keys, admin token, paired phones (token hashes only) | Until you change it |
| `uploads/` | Photos and files from the phone; copies of chat images for the phone to show | Phone uploads 3 days; image copies 1 day after last use (made again on demand) |
| `serve.log` | The server's log (agents' warnings and errors, not their INFO chatter) | Capped at 5 MB; the last part moves to `serve.log.1` |
| `tokens.json` | Token counts per day, for Usage | 90 days |
| `models.json` | Each agent's model list, with its effort levels | Refreshed every 6 hours |
| `quick.json`, `quick.log` | The quick tunnel's address and its cloudflared log | While the tunnel is on |
| `tunnel.log` | The named tunnel's cloudflared log | Since its last start |
| `schedules.json`, `usage.json` | Scheduled runs; plan usage | Until you change them |
| `artifacts/` | Pages agents showed (the index, and pages passed as HTML) | 30 days |
| `templates/` | Your agent roles | Until you change them |
| `mcp/` | A running Claude thread's tool config (its token) | Until that Claude exits |

Never commit pairing payloads, tokens, private keys, Cloudflare credentials, or `~/.luther` contents. Review logs before sharing. Automated cryptographic tests are not a claim of independent security audit.

For a suspected vulnerability, contact the maintainer privately through their [GitHub profile](https://github.com/AJAmit17) before posting exploit details. Use GitHub private vulnerability reporting if enabled for this repository.

## Architecture

| Location | Responsibility |
| --- | --- |
| `server/internal/api` | Composition root: feature packages and HTTP routes. |
| `server/internal/hub` | Live threads and the `Runtime` agent-adapter interface. |
| `server/internal/claude`, `codex`, `acp` | Provider process/protocol handling. |
| `server/internal/workspace` | Files, repositories, Git, and worktrees. |
| `server/internal/auth`, `seal`, `e2e` | Authentication and sealed transport. |
| `server/internal/tunnel` | Cloudflare quick and named tunnels: start, keep alive, close. |
| `server/internal/uploads` | Phone uploads, chat image copies, and their cleanup. |
| `server/internal/lifecycle`, `cli` | Background operation and Cobra/Lip Gloss commands. |
| `app/src/app` | Expo Router routes, mostly screen re-exports. |
| `app/src/components` | Screens, chat controls, and shared UI. `ios/` and `android/` hold per-platform versions; `@/components/<name>` resolves to the right one. |
| `app/src/lib` | Protocol, client logic, state, palette, and pure tests. |
| `app/src/widgets` | Separate-runtime widgets and Live Activities. |
| `assets/brand` | Relay vectors, outlined wordmarks, and social artwork. |

Go wire structs are authoritative; TypeScript mirrors them in `app/src/lib/protocol.ts`. Feature packages keep their behavior and routes together. See [docs/PLAN.md](docs/PLAN.md) for decisions and verification gaps.

## Development and contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md) and applicable `AGENTS.md` files.

From `server/`:

```sh
go vet ./...
go build ./...
go test -race ./...
```

From `app/`:

```sh
npm ci
npm run typecheck
npm run lint
npm test
```

On macOS, regenerate branding from the repository root:

```sh
swift scripts/generate-brand.swift
```

The generator reads the shared palette and creates repository SVGs/PNGs and Icon Composer artwork. Wordmarks are outlined paths: viewers do not need the generating machine's fonts. Do not hand-edit generated artwork.

## Current limits

- Pre-release; no completed public-release/TestFlight workflow is claimed.
- Widgets and Live Activities are iPhone-only; iPad is not validated.
- Provider protocols and capabilities vary and can change independently.
- Initial usage-history scans can be slow; subsequent requests use caching.
- An asleep, powered-off, or lid-closed Mac cannot reliably continue work or accept requests.
- Closing the phone app can delay notifications and approvals.
- Browser previews have different security/routing limits from the sealed connection.

## Credits and licensing

Created and maintained by **[Amit Acharya](https://github.com/AJAmit17)**. See [CONTRIBUTORS.md](CONTRIBUTORS.md) for project credit and upstream acknowledgments.

Unless otherwise noted, Luther is licensed under the **[Apache License, Version 2.0](LICENSE)**. Project attribution is recorded in [NOTICE](NOTICE); third-party components retain their own licences and notices.

When redistributing Luther or covered derivatives, follow Apache 2.0 section 4: provide the licence, mark modified files, preserve applicable source notices, and retain the applicable `NOTICE` attribution in a permitted location.

Apache 2.0 permits commercial/proprietary use and does **not** require publishing your modifications or displaying a “Built with Luther” badge. A visible credit/link is appreciated but optional; it is not an extra licence condition.

See the [licensing comparison](docs/LICENSING.md) for attribution versus source-sharing requirements and the primary licence texts.

Luther is independent of the agent providers. Their names/logos identify their products and do not imply sponsorship or endorsement.

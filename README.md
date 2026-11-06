<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/wordmark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/brand/wordmark-light.svg">
    <img src="assets/brand/wordmark-light.svg" alt="Luther" width="300">
  </picture>
</p>

<p align="center"><strong>Your agents. Your Mac. Anywhere.</strong></p>
<p align="center">A self-hosted control plane for coding agents, steered from your iPhone.</p>
<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#agents">Agents</a> ·
  <a href="#build-the-iphone-app">iPhone app</a> ·
  <a href="#security-and-trust">Security</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="LICENSE">Apache 2.0</a>
</p>

---

Luther connects your phone to the coding agents running on your own machine. Start a task, leave your desk, review its progress, answer an approval, or open a terminal without moving the repository or the agent's login to a hosted service.

The Mac keeps the files and runs the agents. The phone is the controller. Connect over **Tailscale**, **Cloudflare Tunnel**, or a remote machine reached through **SSH**.

**Status:** pre-release. macOS and iPhone are the primary experience; the server also supports Linux. The iOS app is built from source and installed as a signed native app. There is no published App Store/TestFlight installation flow yet. Device/network end-to-end checks and release work are tracked in [the project plan](docs/PLAN.md).

This branding/licensing branch is based on `main`. The separate `feat/luther-lifecycle-agents-workspaces-usage` branch contains the daily-driver additions described [below](#companion-feature-branch); they are not included here.

## What you can do

| Capability | What it means |
| --- | --- |
| Continue real agent sessions | Stream responses, switch models and permission modes, interrupt work, and resume supported sessions. |
| Stay in control | Answer permission requests, questions, and plans from the phone. Concurrent clients share a thread; the first accepted answer wins. |
| Work in a repository | Open an agent workspace and use Git operations in an individual checkout. Parent-folder repository selection belongs to the companion feature branch. |
| Inspect the work | Browse files, review changes and per-turn checkpoints, commit, push, and create pull requests using the Mac's own tools. |
| Use a persistent terminal | Open a tmux-backed terminal that can survive a phone disconnect and be attached to on the Mac. |
| Check plan limits | View Claude/Codex usage windows and reset times in Settings. Daily token analytics belong to the companion feature branch. |
| Reach other machines | Relay another Luther server through a maintained SSH forward instead of exposing that host directly. |
| Keep tasks moving | Schedule prompts, attach files, dictate messages, inspect local dev-server previews, and use widgets or Live Activities. |

Luther invokes the providers' own CLIs. It does not replace their subscriptions, logins, limits, sandboxes, or permission models.

## How it works

```text
iPhone
  │
  ├── Tailscale HTTPS route ──────────┐
  └── Cloudflare HTTPS tunnel ────────┤
                                     ▼
                         Luther on 127.0.0.1
                         ├── agent CLI processes
                         ├── sessions, files, Git, terminals
                         └── SSH forward → another Luther server
```

- **One Go server** runs on the machine with your repositories.
- **One Expo/React Native app** controls it from the iPhone.
- **No Luther-hosted relay or database.** Provider CLIs retain their session histories; Luther owns configuration, device records, and supporting local state.
- **Existing agent logins stay on their machine.** Provider API keys do not need to be entered into the phone.

## Requirements

### Agent machine

- macOS, or Linux with a working systemd user session for background lifecycle commands.
- At least one supported agent CLI, installed and logged in as the user who runs Luther.
- Git for repository operations; tmux for terminals.
- Tailscale with Serve enabled, or an existing Cloudflare Tunnel setup.
- GitHub CLI (`gh`) logged in on the agent machine for pull-request creation.
- Go **1.26.7 or newer** when building from source, as specified in [`server/go.mod`](server/go.mod).

The agent process runs with the server user's permissions. Use an account and workspace you trust.

### iPhone build

A Mac with compatible Xcode, CocoaPods, Node **24.3+ within 24.x** or **26.x**, and Apple signing configured. Tests use Node's native TypeScript support. The app uses Expo **58**, React Native **0.88**, and React **19.3**. Use the lockfile rather than upgrading them independently.

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
luther tailscale
luther service install
```

`service install` starts Luther in the background and enables startup at login. Use `luther serve` for foreground operation. The shorter `start`/`stop`/`status` lifecycle belongs to the companion feature branch.

For Cloudflare instead, run `luther tunnel` for setup instructions. After creating the tunnel and configuring credentials/DNS, register its real URL and ID:

```sh
luther tunnel --url https://luther.example.com --id <TUNNEL_UUID>
```

The example hostname is a placeholder. The command configures Luther's route and tunnel file; it does not create your Cloudflare account, DNS, or tunnel credentials. If using Cloudflare Access, configure its service-token headers in the app's route settings.

The route also requires a running `cloudflared` process. On macOS, `luther service install` manages the configured tunnel at login when `cloudflared` is installed. Alternatively, run `cloudflared tunnel --config "$HOME/.cloudflared/luther.yml" run` through your own service manager.

### 3. Install the app and pair

Build the [native iPhone app](#build-the-iphone-app), then:

```sh
luther pair
```

Scan the QR code **inside Luther**, or paste the pairing payload into its pairing screen. The code is short-lived and single-use; treat the QR and JSON payload as sensitive.

Pick a folder, select an installed agent, and send a task. For Git operations on this branch, open the individual Git checkout rather than a non-Git parent folder.

## Everyday commands

| Command | Purpose |
| --- | --- |
| `luther version` | Print the build version. |
| `luther serve` | Explicit foreground mode, also used by service managers. |
| `luther pair` | Generate pairing instructions and a QR code. |
| `luther tailscale` | Configure Tailscale Serve for the local listener. |
| `luther tunnel` | Show Cloudflare setup instructions. |
| `luther doctor` | Diagnose installed tools, server, and routes. |
| `luther service install` / `uninstall` | Install or remove startup-at-login behavior. |
| `luther remote add\|pair\|list\|remove` | Manage SSH-relayed agent machines. |

Bare `luther` starts the foreground server on this branch; it is not a read-only overview. Cobra help/completion and Lip Gloss styling belong to the companion feature branch.

Use `luther service uninstall` to remove the managed login service. Logs are under `~/.luther/`, including `serve.log`. Wake protection does not override lid-close sleep.

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
| OpenCode | `opencode acp` | ACP capabilities determine models, modes, and session operations. |
| Gemini CLI | `gemini --acp` | Requires a CLI version exposing the ACP interface. |
| Cursor | `cursor-agent acp` or `agent acp` | Requires a compatible installed command. |

ACP adapters share a protocol, not a guarantee of identical capabilities. Models and permissions depend on the agent. Live model turns and all providers' real permission paths are not universally verified. Devin support belongs to the companion feature branch. See the [end-to-end checklist](docs/PLAN.md#phase-10-end-to-end-tests).

## Usage and notifications

Settings shows Claude/Codex plan-limit windows and reset times, not a daily token-burn ledger. The dedicated Usage tab, transcript aggregation, cost coverage, and deterministic Compact/Full formatter belong to the companion feature branch.

Notifications and Live Activities depend on events the app can receive. Background refresh may replay run summaries when iOS wakes the app. **Instant closed-app remote push is not implemented.** Do not rely on a suspended or closed app receiving immediate notifications.

## Companion feature branch

`feat/luther-lifecycle-agents-workspaces-usage` separately contains:

- On-demand `luther start` / `stop` / `status`, with macOS idle-sleep protection on battery and AC.
- Cobra command parsing/help/completion, Lip Gloss presentation, plain/no-color modes, and status JSON.
- Provider identity in the thread header without the duplicate composer chip.
- Devin through `devin acp`, preserving its native read-only Ask mode.
- Explicit child-repository selection inside non-Git parent workspaces.
- A dedicated Usage tab with 7/30/90-day token charts, provider/model and cache totals, and reported costs without inventing subscription bills.
- Deterministic base-1,000 K/M/B/T formatting, a remembered Compact/Full toggle, and chart-overflow cues.

Those additions have their own verification history and outstanding real-device/network checks. This branch intentionally does not import their commits.

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

- The server binds to **`127.0.0.1`**, not a public interface. Tailscale Serve and Cloudflare Tunnel proxy to it.
- Protected operations require authentication. Pairing uses a short-lived code; devices can be revoked in Settings.
- Key-paired phones seal API requests and event streams using X25519, HKDF-SHA256, and AES-256-GCM, with freshness/replay checks.
- Browser dev-server previews use a separate token/cookie proxy and are **not** covered by the sealed app protocol. Relays still see connection metadata. Static device/server keys do not provide forward secrecy.
- Provider-owned stores are read-only to Luther; it does not write configuration or credentials into `~/.claude` or `~/.codex`.
- File confinement reduces mistakes; it does not make an agent with full access safe against malicious instructions. Git operations on this branch require an individual checkout.

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
| `server/internal/cli` | Commands, login services, networking setup, and remote hosts. |
| `app/src/app` | Expo Router routes, mostly screen re-exports. |
| `app/src/components` | Screens, chat controls, and shared UI. |
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
- iPhone-first; Android is not at feature parity and iPad is not validated.
- Provider protocols and capabilities vary and can change independently.
- Companion-branch transcript scans can be slow initially; subsequent requests use caching.
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

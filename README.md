# Luther

Drive the coding agents on your Mac (Claude Code, Codex, OpenCode, Gemini CLI, Cursor, Devin CLI) from your phone, over your tailnet or a Cloudflare tunnel. Traffic between the phone and the Mac is end-to-end encrypted, so a tunnel only ever relays ciphertext.

- `server/` — the Go server (`luther serve`), on macOS or Linux
- `app/` — the Expo iPhone app
- `docs/PLAN.md` — spec and build plan

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/AJAmit17/luther/main/install.sh | sh
```

or with Homebrew:

```sh
brew tap AJAmit17/luther https://github.com/AJAmit17/luther && brew install luther
```

The script downloads the release for your OS and CPU (checksum verified), or builds from source with Go when there's no release. While the repository is private, set `GITHUB_TOKEN` for the download (the source build uses your git login).

Then:

```sh
luther doctor            # what's installed, what's missing
luther tailscale         # a route over your tailnet (and/or: luther tunnel)
luther start             # run in the background; this terminal stays free
luther pair              # QR for the app
luther status            # check the local server
luther stop              # stop the managed server and allow idle sleep again
```

On macOS, the server holds `caffeinate` idle-sleep assertions on battery and AC until it stops. This does not override lid-close sleep. Logs are in `~/.luther/serve.log`. `start` is on-demand; use `luther service install` separately to start at login. If installed at login, `stop` stops it for the current login; the installed service still starts at the next login. `luther serve` remains available for foreground debugging.

Running `luther` without a command now shows a read-only overview instead of starting a foreground server. Use `luther --help` or `<command> --help` for grouped commands, flags and examples. `luther completion bash|zsh|fish|powershell` generates shell completion. Terminal output uses a compact styled layout; pipes and dumb terminals get plain output. `NO_COLOR=1` or `--no-color` disables colors. `luther pair --json` remains an undecorated pairing payload; `luther status --json` provides a credential-free status summary.

Devin uses its released `devin acp` interface and the CLI's existing login. Its native Ask mode is read-only; Auto-accept edits, Plan and Full access map to Devin's Code, Plan and Bypass Permissions modes.

The Changes screen discovers git checkouts inside a multi-repository chat folder. Choose a repository before a git action; Luther never initializes the parent or commits across repositories implicitly. Separate-worktree threads also let you choose which checkout to use.

The Usage tab shows plan limits and daily token burn for 7, 30 or 90 days, with provider/model and input/output/cache breakdowns. Claude and Codex history includes readable local transcripts, even from terminal sessions. Other agents contribute only explicit usage reported by prompts run through Luther after this update. Costs are reported amounts only, not estimates or subscription charges; unavailable usage and costs are not represented as known zeroes.

## Agents on other machines

A server with your code (and its agents) can be driven the same way, without a public route of its own: this Mac keeps an SSH forward to it and relays it.

```sh
luther remote add devbox me@devbox.example.com   # needs key-based ssh
luther remote pair devbox                        # QR: pairs the phone with devbox through this Mac
```

## Scheduled runs

Schedules (Home → Mac menu, or a project's menu) open a new thread with a prompt on a timetable: hourly, daily, weekdays, weekly or any cron expression. You hear about each run like any other: notifications, Live Activity, approvals.

## Releasing

`git tag v0.2.0 && git push origin v0.2.0` builds macOS and Linux binaries, publishes a GitHub release with checksums, and points the Homebrew formula at the tag (`.github/workflows/release.yml`, `scripts/build-release.sh`).

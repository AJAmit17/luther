# Luther

Drive the coding agents on your Mac (Claude Code, Codex, OpenCode, Gemini CLI, Cursor) from your phone, over your tailnet or a Cloudflare tunnel. Traffic between the phone and the Mac is end-to-end encrypted, so a tunnel only ever relays ciphertext.

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
luther service install   # run now and at login (launchd; systemd on Linux)
luther pair              # QR for the app
```

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

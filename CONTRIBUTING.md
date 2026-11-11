# Contributing to Luther

Luther keeps agents and repositories on the user's machine while the phone steers them. Contributions should preserve that ownership model and make the daily workflow clearer, safer, or more reliable.

The project is pre-release. Read [README.md](README.md), [docs/PLAN.md](docs/PLAN.md), and applicable `AGENTS.md` files first. Luther uses [Apache 2.0](LICENSE); intentionally submitted contributions follow section 5 unless separately agreed. Contributors retain copyright in their work.

## Before writing code

- Check existing issues and pull requests for overlapping work.
- For a bug, provide expected/actual behavior, versions, and a minimal reproduction.
- Discuss new agents and large features first: their protocol, state ownership, and user workflow matter.
- Keep changes focused. Avoid unrelated formatting, dependency upgrades, or generated-file churn.

Never attach tokens, pairing payloads, private keys, provider transcripts, or private repository contents to a public report. Review logs and screenshots before sharing them. Contact the maintainer privately about suspected vulnerabilities.

## Development setup

Use the toolchain specified by the manifests:

- Go 1.26.7 or later for `server/`.
- Node 24.3+ within 24.x or 26.x, and npm for `app/`; tests use native TypeScript support.
- Git and tmux for workbench testing.
- macOS with Xcode/CocoaPods for native iPhone builds and artwork generation.
- Logged-in provider CLIs only when deliberately exercising real integrations.

```sh
cd app
npm ci
```

Build the server without installing or restarting a live service:

```sh
cd server
go build -o luther .
./luther version
```

Help, completion, and version output must remain side-effect-free. Do not point exploratory tests at a personal running server.

For a physical iPhone, follow [the native Release workflow](README.md#build-the-iphone-app). Prebuild may generate native projects; Expo Go, `expo run:*`, and Metro are not part of physical-device deployment here.

## Server conventions

- Prefer Go's standard library and justify new dependencies.
- Give each feature a focused `server/internal/*` package with a small interface and, where appropriate, `Routes(mux, wrap)`.
- Keep `internal/api` as the composition root and `hub.Runtime` as the agent-adapter seam.
- Do not duplicate provider-owned session history into another database.
- Never write to `~/.claude` or `~/.codex`.
- Preserve authentication and path-confinement checks. Treat network input, uploaded files, and Git roots as untrusted.
- Git mutations target one explicitly selected repository, not every checkout below a parent folder.

### Isolate tests from the real home

Before test code can load configuration or create state:

```go
paths.Home = t.TempDir()
```

Use temporary directories and fake protocol peers. Tests must not require personal credentials, a particular active session, or a paid model turn. For a reproducible bug, add a failing regression test before the fix.

## App conventions

- Use Expo Router with thin route files. Screens live in `src/components`, the design system in `src/design` (import from `@/design`), Luther-specific building blocks in `src/features`, and logic in `src/lib`.
- Read the documentation matching Expo SDK 58 before changing its APIs/config plugins.
- Use `npx expo install` for compatible app dependencies; do not upgrade React Native independently.
- Build screens from `@/design`: tokens for spacing, radius and type, `useTheme()` colours, `Press` (or a component on it) for every tap; no hex literals or font sizes in screens. Filled actions use `onAccent`, not assumed white.
- Differentiate working, waiting, completion, and failure with text/symbols, not color alone.
- Check both appearances, long labels, large text, keyboards, and actual native rendering for visual changes.
- Keep generated native directories out of source changes. Fix configuration through `app.config.js` and plugins.
- Widgets have a separate runtime; imported app constants and closures are not automatically available inside them.

Extract pure behavior into `src/lib` and use the existing Node test setup.

### Usage and missing data

Reuse `src/lib/usage.ts`. Hermes can ignore compact `Intl.NumberFormat` notation; existing tests cover this limitation. Units are base 1,000: K/M/B/T.

Context occupancy is not token consumption. Missing usage/costs are not known zeroes, and reported costs are not estimated subscription bills. Preserve transcript/counter deduplication.

## Protocol and cryptography

Go structs in `server/internal/protocol` are authoritative. Mirror changes in `app/src/lib/protocol.ts` in the same pull request.

Cryptography changes must update both `server/internal/seal` and `app/src/lib/e2e.ts`, preserve the shared test vector, and receive focused review. Never change authentication or encryption as a side effect of a UI cleanup.

## Relay branding

The approved Relay mark consists of two offset return paths. Geometry lives in `scripts/generate-brand.swift`; colors come from `app/src/lib/palette.ts`.

Regenerate on macOS from the repository root:

```sh
swift scripts/generate-brand.swift
```

Commit generated assets with their source changes and inspect the images:

| Asset | Purpose |
| --- | --- |
| `assets/brand/mark.svg` | Reusable monochrome vector. |
| `assets/brand/mark-light.svg`, `mark-dark.svg` | Appearance-specific marks. |
| `assets/brand/wordmark-light.svg`, `wordmark-dark.svg` | Outlined repository lockups. |
| `assets/brand/social-preview.png` | 1200×630 repository/social artwork. |
| `app/assets/luther.icon` | Layered native icon. |
| `app/assets/images/luther-*` | Fallback, adaptive, monochrome, favicon, and splash bitmaps. |

Wordmarks use the local macOS system font converted to paths; OS/font changes can affect regeneration. Do not edit generated artwork directly or pre-mask app icons with rounded corners. Provider marks are distinct from Luther's brand and retain their applicable notices.

The Icon Composer layer must use closed filled outlines, not the web mark's open strokes: layer-fill overrides can otherwise change the silhouette. Inspect the compiled icon, not only the fallback PNG. Bitmap/configuration regression tests run with the app tests.

## Required verification

From `server/`:

```sh
go vet ./...
go build ./...
go test -race ./...
```

From `app/`:

```sh
npm run typecheck
npm run lint
npm test
```

Run `git diff --check`; review generated assets and local documentation links.

Automated checks are not proof of physical-device, tunnel, live-agent, SSH, sleep/wake, or background-notification behavior. Exercise the relevant real path when possible and state remaining gaps. Do not complete the end-to-end checklist based on a fake peer or a TypeScript build.

## Pull requests

Include the user problem, why the approach helps, behavior/protocol/config changes, and verification results. Add native screenshots for visible changes; distinguish screenshots from mockups. State limitations and manual checks not performed.

Update the specification when behavior changes. Do not publish secrets in fixtures/screenshots, push or tag releases without agreement, or rewrite another contributor's history.

## Releases and attribution

Release tooling exists, but the first real release and TestFlight distribution are separate milestones. A `v*` tag triggers `.github/workflows/release.yml`.

`scripts/build-release.sh` replaces generated `dist/` output. Run it only when that directory is disposable. Archives include the project's `LICENSE` and `NOTICE`; the installer retains them, and the formula installs them. Before publication, verify archives/checksums, third-party licence obligations, the formula revision, and installation. Native-app distribution must also preserve applicable licence/attribution notices.

Contributors retain credit. Preserve accurate upstream authorship and copyright/licence notices. Any additional legal contribution requirements must be established openly, not assumed.

# Luther

Control plane for the coding agents on a Mac (Claude Code, Codex), steered from a phone over a tailnet or Cloudflare tunnel. Go server in `server/`, Expo app in `app/`.

**Before any work, read `docs/PLAN.md`**: spec, decision log, phase checklist. Resume at the first unchecked item; spec changes go into `docs/PLAN.md` in the same change as the code.

- Server: Go, stdlib first; `cd server && go vet ./... && go build ./...` before claiming done.
- Server layout: one package per feature under `server/internal/` (protocol, config, auth, seal, e2e, hub, claude, codex, acp, rpc, checkpoint, sessions, schedule, remote, terminal, workspace, uploads, usage, preview, cli; tiny helpers text/paths/httpx/env). Each exposes a small interface plus `Routes(mux, wrap)`; `internal/api` is the composition root and the only place that wires packages together. The agent seam is `hub.Runtime` (adapters: claude, codex, acp). New feature → new package, not a new file in another one.
- App: `cd app && npx tsc --noEmit` before claiming done; use `npx expo install` for packages.
- Wire protocol: Go types are the source of truth; mirror every change in `app/src/lib/protocol.ts`.
- Never write to `~/.claude` or `~/.codex` — those are the CLIs' stores; Luther only reads them.
- Tests never touch the real `~/.luther`: set `paths.Home = t.TempDir()` first.
- Crypto changes go to both `server/internal/seal` and `app/src/lib/e2e.ts`; the shared test vector must still pass on both sides.
- GitHub: account AJAmit17 (this repo's git config handles auth).

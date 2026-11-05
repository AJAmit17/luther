# Luther

Control plane for the coding agents on a Mac (Claude Code, Codex), steered from a phone over a tailnet or Cloudflare tunnel. Go server in `server/`, Expo app in `app/`.

**Before any work, read `docs/PLAN.md`**: spec, decision log, phase checklist. Resume at the first unchecked item; spec changes go into `docs/PLAN.md` in the same change as the code.

- Server: Go, stdlib first; `cd server && go vet ./... && go build ./...` before claiming done.
- App: `cd app && npx tsc --noEmit` before claiming done; use `npx expo install` for packages.
- Wire protocol: Go types are the source of truth; mirror every change in `app/src/lib/protocol.ts`.
- Never write to `~/.claude` or `~/.codex` — those are the CLIs' stores; Luther only reads them.
- GitHub: account AJAmit17 (this repo's git config handles auth).

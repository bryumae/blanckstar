# Agent guide — blanckstar

Read `CLAUDE.md` before making substantive changes in this repo. `CLAUDE.md`
is the full contributor guide and the primary source of truth.

This file is intentionally short so agent tooling can discover the repo rules
quickly, then defer to `CLAUDE.md` for the complete guidance.

## Critical rules

1. **Read `CLAUDE.md` first.** Treat it as required repo context, not optional
   background reading.
2. **Coverage gate, scoped to `src/core/`.** `npm test` must pass, and the
   100/95/90 per-file thresholds described in `CLAUDE.md` apply there.
3. **Keep the layers honest.**
   - pure logic in `src/core/`
   - the two Web Workers in `src/sim/` and `src/sandbox/`
   - Three.js glue in `src/render/`
   - DOM screens in `src/ui/`
   - environment side effects injected through `src/net/` seams
4. **No secrets in git.**
5. **The build stays Vite-only.** Avoid adding runtime dependencies casually —
   follow the dependency guidance in `CLAUDE.md`.

## Working rule

When `AGENTS.md` and `CLAUDE.md` differ, update them to match, but follow the
more complete guidance in `CLAUDE.md` for the current task.

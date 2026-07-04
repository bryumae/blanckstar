# Contributing to blanckstar

Thanks for your interest! This is a Vite + TypeScript + Three.js browser game
with no backend. Quality is held by tests and a strict layering discipline —
please read the hard rules below before opening a PR.

## Quickstart

```bash
npm install
npm test            # vitest + coverage gate, scoped to src/core/ (must pass)
npm run build       # tsc -b && vite build
npm run dev         # local dev server
npm run test:e2e    # Playwright (chromium/firefox/webkit); needs: npx playwright install
```

Requirements: Node 22 (see `.nvmrc`).

## Hard rules (non-negotiable)

These mirror `CLAUDE.md` (the in-repo agent guide) — the same rules apply to
human contributors.

1. **The coverage gate must pass.** `npm test` enforces **100% statements/
   lines, 95% functions, 90% branches, per file** — scoped to `src/core/`
   only. Everything else (`src/sim/`, `src/sandbox/`, `src/render/`,
   `src/ui/`, `src/main.ts`) is integration-tested glue with no hard numeric
   floor. **Add tests in the same change as the code.**
2. **Keep the layers honest.**
   - Pure logic → `src/core/` (no DOM, no worker globals).
   - The two Web Workers → `src/sim/` (simulation) and `src/sandbox/`
     (player-script sandbox), talking to the main thread through an injected
     `postMessage` seam.
   - Three.js glue → `src/render/`; push math into `src/core/` instead.
   - DOM screens → `src/ui/telescope/`, `src/ui/sequence/`, `src/ui/data/`.
   - Side-effectful environment access (localStorage, JSON fetch) → injected
     through `src/net/` seams, never imported directly.
3. **No secrets in git.**
4. **The build is Vite-only; runtime dependencies are rare and deliberate.**
   Currently the only runtime dependency is `three`. Adding another is a
   deliberate decision — see `CLAUDE.md` hard rule 4.
5. **No UI framework for game screens.** Plain HTML/CSS/DOM only — see
   `CLAUDE.md` hard rule 5.

## Pull requests

- Branch off `main`; keep PRs focused.
- `npm test` green (coverage gate) and `npm run build` succeeds.
- Update `CHANGELOG.md` (`[Unreleased]`) when behavior changes.
- See `.github/PULL_REQUEST_TEMPLATE.md` for the full checklist.

## Reporting bugs / security

Open a GitHub issue for bugs and feature requests. For security-sensitive
reports, follow `SECURITY.md` instead of filing a public issue.

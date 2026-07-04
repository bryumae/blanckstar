# Changelog

## [Unreleased]

- Phase 9 (#12), scenarios half: `scripts/validateScenarios.ts` proves both
  curated seeds winnable through the real engine (shooting-method reference
  solutions, no Lambert per §11); seed 2 "Long way home" was retuned during
  validation — the original start never re-approached Earth within the
  ephemeris span; new values give ~1.01 AU, ~2.4° inclination, natural
  approach near day 176 (`npm run validate:scenarios`).

- Phase 9 (#12), app-shell half: app shell (`src/ui/shell/`) replacing the
  bare stacked-sections `index.html` — 48px header (brand, live UTC/MET
  clocks, time-warp control mirrored from the Data screen, pulsing
  Earth-beacon lock indicator, scenario badge) and 220px nav rail (screen
  switcher + system-vitals mini-panel), built against
  `docs/design/mission-interface-template.html`. All three primary screens
  stay mounted; the shell toggles visibility via `is-active` and pauses the
  telescope's render loop while hidden. Minimal start-flow scenario picker
  (persists last-chosen seed id in `localStorage`) plus win/lose result
  overlays (elapsed time, Δv spent, final Earth-relative orbit on capture;
  failure reason otherwise) with retry-same-seed / choose-another-seed
  actions — scripts/notes/candidates persist per §2.3, verified rather than
  rebuilt. Fixed a debug-overlay nit where it showed dashes until the first
  post-mount state event (now nudges a no-op `setWarp` on `ready`). Added
  `public/favicon.svg`. README added covering quickstart, physics model, full
  scripting API reference, win/lose conditions, screens, debug mode, and
  known limitations. New Playwright e2e specs covering the scenario-picker
  boot flow, nav-rail screen switching, running the default script, the Data
  screen's radio-lock flow, and debug-mode gating; new unit specs for the
  shell's DOM wiring in `tests/unit/uiShell.test.ts`.
- Added `docs/design/` — Mission Interface design reference from claude.ai
  Design Canvas: bundled export, decoded template, extracted IBM Plex fonts,
  and normalized `tokens.css` (moved from repo root).
- Planning: MVP0 roadmap issue #3 with phase issues #4–#12 following spec §13.
- Phase 5 (#8): player-script sandbox (Worker #2) + sequence console. Sandboxed
  real-JS execution with a neutralized global scope and the full §8.2 game API
  (time/log/radio/sensors/telescope/ephemeris/vec/ship/predict/constants);
  §8.3 forbidden surface absent. Main-thread bridge relays API calls to the sim
  worker over the frozen ADR-0001 protocol (requestId + FIFO-by-kind
  correlation), with `wait()` skip-to-time semantics (early-resolve on
  interrupt), terminate-based stop, and a heartbeat watchdog. In-worker
  `predict()` shares `src/core`/`src/sim/physics` for engine parity. Sequence
  screen shell with a tab-registration seam for later phases; named scripts
  persist via the injected storage seam. See `docs/ADR-0002-sandbox-api.md`.

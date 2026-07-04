# Changelog

## [Unreleased]

- Code-review fixes (PR #14, 10 findings). Sandbox/sim protocol correlation:
  `wait()` no longer hangs when issued after the game is over or to a past
  target — the sim emits a completed `skipProgress` on a no-op skip and the
  bridge resolves `wait()` immediately once `won`/`lost` has fired;
  `BurnEndedEvent` gained a `scheduledId` so a scheduled burn's completion no
  longer resolves a pending immediate `burn()` waiter; `ErrorEvent` gained an
  optional `command` tag so a sim error rejects the matching waiter instead of
  a fixed-priority guess (both additive, ADR-0001 addendum). Sim: a win/lose
  reached during `skipToTime` no longer emits a spurious `interrupted`
  alongside the verdict. Warp: the driver now advances whole boundary-snapped
  substeps against a carried budget instead of clamping `dt` to a wall-clock
  slice, so a warped run is frame-rate independent and bit-matches
  `skipToTime` (§6). Sandbox: the parameter-shadow backstop (`runner.ts`) now
  covers every §8.1 forbidden network/messaging global, not just the hint
  names (ADR-0002 addendum). Predictor parity: `predict()` and the Predictor
  tab no longer feed the output-sample cadence (or chunk boundary) into the
  integrator, so a predicted trajectory matches the sim's own propagation
  regardless of `stepOut`/`chunkSeconds` (§7.7/§8.2) — sample times are now
  step-aligned. UI: the Data screen's candidate "Save as candidate" persists
  the run-time epoch/velocity rather than later form edits; the debug overlay
  no longer busy-loops ephemeris queries + duplicate trace points while
  paused; the nav-rail "Beacon" system-vital now tracks the header lock state.

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

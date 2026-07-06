# Changelog

## [Unreleased]

- Closes #17: lifts the shared "gravity + thrust + tiered-timestep RK4
  advance" wiring (`gravitatingBodiesAt`/`makeAcceleration`/`advance`,
  formerly `src/sim/physics.ts`) and the scheduled-burn helpers
  (`thrustAt`/`burnBoundaries`, formerly duplicated as `PredictBurn`
  in `src/sandbox/predict.ts` and `PredictorBurn` in
  `src/ui/sequence/tabs/predictorEngine.ts`) into pure `src/core/advance.ts`
  and `src/core/burn.ts` modules, importable by the sim, the sandbox, and the
  UI alike — the root cause behind the predictor-parity fixes in PR #14.
  Also: `src/render/astro.ts`'s `phaseAngle()` now delegates to
  `src/core/vector3.ts`'s `angleBetween()` instead of re-deriving the same
  dot/norm/acos math, and `src/ui/data/format.ts`/`src/ui/shell/format.ts`'s
  identical `fmtKm`/`fmtKmPerS`/`fmtDegrees` are hoisted into a shared
  `src/ui/format.ts` (their non-identical `fmtMet` — one has a "MET " prefix,
  one doesn't — stays screen-local, and `src/ui/debug/format.ts`'s
  vector-shaped formatters were left as-is since they're a genuinely
  different API, not a literal duplicate).

- Fixes #18: core numeric edge cases now degrade deterministically instead of
  leaking invalid states. Light-time callers backed by ephemeris data clamp
  emission-time sampling to body coverage at the dataset boundary; parabolic
  orbital elements use a positive-infinity semi-major-axis sentinel and
  energy-only bound classification; exact body/ship gravity coincidence
  contributes zero acceleration instead of NaN/Infinity; and the exact
  120 km Earth-atmosphere floor is treated as loss rather than a win/loss
  dead band. Clamped light-time solutions keep the ephemeris sample time
  bounded while reporting radio range and displayed light-time from the
  geometric distance, not from the clamped timestamp delta.

- Fixes #16: `mountTelescopeScreen`'s and `mountDebugOverlay`'s `destroy()`
  now abort the `window`-level `mousemove`/`mouseup` (and, for the telescope
  screen, filter-menu-close `click`) listeners added at mount, via a shared
  `AbortController` passed as each listener's `signal`. Neither `destroy()`
  is called from `main.ts` today so this was latent, but it would have
  accumulated stale-closure listeners on any future remount flow.

- Closes the last item tracked by #19: the latent floating-origin/picking
  concern. `src/render/picking.ts`'s `pickNearest` now normalizes the ray
  direction (the one input this module doesn't control the construction of)
  via `src/core/vector3.ts`'s shared `normalize`/`dot` rather than a local
  reimplementation, and trusts candidate directions to already be unit-length
  per the documented `PickCandidate` contract instead of re-normalizing all
  ~5000 star-catalog candidates on every click for no behavioral benefit (a
  code-review pass on the first attempt at this fix found the local
  duplicate + per-candidate normalization was both a CLAUDE.md layering
  violation and wasted work). `src/render/scene.ts`'s `updateFrame` now warns
  once (instead of throwing) if `camera.position` ever moves off the world
  origin — bodies and stars are already placed by direction vectors computed
  relative to the ship, so moving the camera too would double-apply the ship
  offset; a throw here would have permanently stopped the `requestAnimationFrame`
  loop in `src/main.ts` (which reschedules itself only after this call
  returns), a worse failure than the regression it guards against and
  inconsistent with this project's graceful-degradation convention for render
  failures. Removed `src/core/floatingOrigin.ts`'s `renderPosition`, a
  Phase-1 helper matching the literal `(body_pos - ship_pos) * scale` formula
  from mvp0_spec.md §4.6 that had zero call sites — the actual render
  approach (direction + fixed render distance, `bodies.ts`) superseded it,
  and its presence was exactly the kind of unused seam that could tempt a
  future change into wiring `camera.position` from ship position directly.

- Render/telescope geometry & photometry fixes (part of #19). Telescope: the
  outside-view FOV readout showed a hardcoded `72.0°` while the camera and pick
  tolerance use the real `OUTSIDE_FOV_DEG = 60` — now shows 60.0°. Starfield:
  the per-star `size` attribute was dead (`THREE.PointsMaterial` renders every
  point at the fixed uniform size), so brighter stars now render larger via a
  compiled-shader patch that reads a per-vertex `aSize` attribute. Initial aim:
  the outside view defaulted to `(0,0,-1)` = the south celestial pole (dec −90),
  while bodies lie near the ecliptic (X/Y) plane; `yawPitchToLookVector` is now a
  Z-up spherical convention (yaw about +Z, pitch toward the pole) so the default
  aim is dec 0 in the ecliptic plane, and the camera up-vector is set to +Z to
  match the world frame. Photometry: reflected-planet brightness now scales with
  each body's own distance from the Sun (1/r_sun² incident sunlight) instead of a
  fixed 1-AU normalization that modelled every body as Earth-lit and made the
  outer planets far too bright (§7.1). Sim: a scheduled burn that interrupts an
  active warp now zeroes `warp` and re-emits state, matching the SOI/win/lose
  interrupt paths (§6) — previously the shell showed an active warp while time
  was frozen until the user re-selected a factor.

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
  slice, so a warped run is frame-rate independent and deterministic across
  machines, following the same integration grid as `skipToTime` (§6); a
  per-tick substep cap drops leftover budget under overload so the carried
  budget can't spiral into a freeze. Sandbox: the parameter-shadow backstop (`runner.ts`) now
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

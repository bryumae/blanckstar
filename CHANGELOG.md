# Changelog

## [Unreleased]

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

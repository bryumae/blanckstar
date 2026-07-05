// Curated scenario seeds (mvp0_spec.md §9). True start states in heliocentric
// ecliptic J2000, SI units, epoch 2026-09-01T00:00:00Z. Player descriptions
// never reveal state. Values are validated winnable by
// scripts/validateScenarios.ts (a developer reference solution runs each seed
// through the real engine and asserts Earth capture).
//
// NOTE(#12): both seeds are derived from Earth's ephemeris state at the epoch,
// then validated winnable by scripts/validateScenarios.ts (a shooting-method
// reference solution flown through the real engine asserts Earth capture).
//   seed 1 "close-call": trailing Earth by ~5×R_SOI, nearly co-orbital — a
//     single ~700 m/s targeting burn brings it to an Earth periapsis pass within
//     ~a month, then a capture burn. Easy, 1–2 burns after a couple of fixes.
//   seed 2 "long-way-home": RETUNED during #12 validation. The original values
//     (3.0e10 m behind + 2.0e10 m inward) put the ship on a heliocentric orbit
//     that never re-approached Earth within the ephemeris span, so the reference
//     solution cost ~9.5 km/s — not the intended "medium" scenario. The retuned
//     start is Earth's own heliocentric state at the epoch rotated +4° in phase
//     about the ecliptic normal, with a +1.2 km/s normal (out-of-plane)
//     component added to the (co-rotated) velocity. This yields |r|≈1.01 AU,
//     ~11×R_SOI ahead of Earth, ~2.4° inclination relative to Earth's orbit, and
//     a natural closest approach of ~10×R_SOI around day ~175 — a genuine
//     fix/predict/correct scenario (larger phase offset than seed 1, inclination,
//     a multi-month coast, a several-hundred-m/s correction plus capture burn).
//     Keep this file the single source of truth for both the app and the
//     validator.
import type { ScenarioSeed } from './types';

export const SEED_EPOCH = 1788220800; // 2026-09-01T00:00:00Z

export const SEEDS: readonly ScenarioSeed[] = [
  {
    id: 'close-call',
    title: 'Close call',
    epoch: SEED_EPOCH,
    position: { x: 140000826439, y: -60754451613, z: 2536747 },
    velocity: { x: 10860.279, y: 28287.059, z: -2.408 },
    playerDescription:
      'Emergency backup computer online. Main computer destroyed on wormhole ' +
      'transit. The beacon crackles — Earth is out there, and by the signal ' +
      'strength, not impossibly far. Find yourself. Get home.',
  },
  {
    id: 'long-way-home',
    title: 'Long way home',
    epoch: SEED_EPOCH,
    position: { x: 143779300098, y: -46098556978, z: 2179134 },
    velocity: { x: 8626.676, y: 28210.698, z: 1197.656 },
    playerDescription:
      'Emergency backup computer online. Main computer destroyed on wormhole ' +
      'transit. The Earth beacon is faint and the sky looks subtly wrong — ' +
      'this orbit is nothing like the one you left on. It will take several ' +
      'correction cycles to get home. Start measuring.',
  },
];

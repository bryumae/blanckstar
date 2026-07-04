// Curated scenario seeds (mvp0_spec.md §9). True start states in heliocentric
// ecliptic J2000, SI units, epoch 2026-09-01T00:00:00Z. Player descriptions
// never reveal state. Values are validated winnable by
// scripts/validateScenarios.ts (a developer reference solution runs each seed
// through the real engine and asserts Earth capture).
//
// NOTE(#12): initial values derived from Earth's ephemeris state at the epoch
// (seed 1: trailing Earth by 4.5e9 m, +0.8 km/s prograde; seed 2: 3.0e10 m
// behind and 2.0e10 m inward with -2.5 km/s prograde and +1.2 km/s normal).
// The scenario-validation pass may retune them; keep this file the single
// source of truth for both the app and the validator.
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
    position: { x: 110789524771, y: -76854136415, z: 4563218 },
    velocity: { x: 9677.485, y: 25206.312, z: 1197.854 },
    playerDescription:
      'Emergency backup computer online. Main computer destroyed on wormhole ' +
      'transit. The Earth beacon is faint and the sky looks subtly wrong — ' +
      'this orbit is nothing like the one you left on. It will take several ' +
      'correction cycles to get home. Start measuring.',
  },
];

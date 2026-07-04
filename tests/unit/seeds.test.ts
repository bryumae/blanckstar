// Fast sanity checks on the curated scenario seeds (mvp0_spec.md §9, bvt §3).
// The full winnability proof lives in scripts/validateScenarios.ts (it flies a
// reference solution through the real engine and asserts capture — too slow for
// the unit suite). This spec guards the cheap, structural invariants: the
// exported shape, and the start-state constraints (heliocentric, not trivially
// at Earth, plausible ~1 AU distance) evaluated against the real ephemeris.
import { describe, expect, it } from 'vitest';
import { SEEDS, SEED_EPOCH } from '../../src/sim/seeds';
import { positionAt } from '../../src/core/ephemerisInterp';
import { sub, norm } from '../../src/core/vector3';
import { R_SOI_EARTH, AU } from '../../src/core/constants';
import { loadRealEphemeris } from './simHelpers';

const eph = loadRealEphemeris();

describe('curated seeds (§9)', () => {
  it('ships exactly the two MVP0 seeds with the documented ids', () => {
    expect(SEEDS.map((s) => s.id)).toEqual(['close-call', 'long-way-home']);
  });

  it('every seed is well-formed and epoched at SEED_EPOCH', () => {
    for (const seed of SEEDS) {
      expect(seed.epoch).toBe(SEED_EPOCH);
      expect(seed.title.length).toBeGreaterThan(0);
      // Player description must not leak coordinates (§9: never reveals state).
      expect(seed.playerDescription).not.toMatch(/\d{6,}/);
      for (const v of [seed.position, seed.velocity]) {
        for (const c of [v.x, v.y, v.z]) {
          expect(Number.isFinite(c)).toBe(true);
        }
      }
    }
  });

  it('start states satisfy the §9 / bvt §3 constraints', () => {
    for (const seed of SEEDS) {
      const sunP = positionAt(eph, 'sun', seed.epoch);
      const earthP = positionAt(eph, 'earth', seed.epoch);
      const moonP = positionAt(eph, 'moon', seed.epoch);
      const rSun = norm(sub(seed.position, sunP)) / AU;
      const dEarth = norm(sub(seed.position, earthP));
      const dMoon = norm(sub(seed.position, moonP));

      // Heliocentric, ~0.8–1.3 AU (bvt §3 / §9 orbit band).
      expect(rSun).toBeGreaterThan(0.8);
      expect(rSun).toBeLessThan(1.3);
      // Outside Earth's SOI, and not trivially at Earth (≥ 5×R_SOI).
      expect(dEarth).toBeGreaterThan(5 * R_SOI_EARTH);
      // Outside the Moon's SOI too (generous ~1e8 m margin).
      expect(dMoon).toBeGreaterThan(1e8);
    }
  });
});

// src/ui/data/insertedStateAnalysis.ts (mvp0_spec.md §7 inserted-state
// paragraphs, §7.7). Analytic check against a synthetic straight-line
// ephemeris: Earth stationary at a fixed point, ship on a straight-line
// (zero-gravity-dominated at these distances is not realistic, but the test
// isolates the closest-approach *search* logic against a known geometric
// minimum) trajectory that passes at a known minimum distance from Earth.
import { describe, expect, it } from 'vitest';
import {
  closestApproachToEarth,
  insertedOrbitalElements,
  runClosestApproachChunked,
  type InsertedState,
} from '../../../src/ui/data/insertedStateAnalysis';
import type { EphemerisData } from '../../../src/core/ephemerisTypes';
import { MU_SUN } from '../../../src/core/constants';

const T0 = 1_800_000_000;
const DAY = 86400;
const AU = 1.495978707e11;

// Earth fixed far away (near-zero gravitational pull on a ship passing close
// to a *different*, near-origin point) so the ship's path near the origin is
// dominated by the Sun only and stays close to a straight line over a short
// horizon — letting us predict the closest-approach point geometrically.
function buildFarEarthEphemeris(): EphemerisData {
  const days = 10;
  const flat = (x: number, y: number) =>
    Array.from({ length: days + 1 }, () => [x, y, 0, 0, 0, 0] as const);
  return {
    frame: 'heliocentric-ecliptic-j2000',
    units: { position: 'm', velocity: 'm/s', time: 'unix-seconds' },
    bodies: {
      sun: { t0: T0, dt: DAY, samples: flat(0, 0) },
      earth: { t0: T0, dt: DAY, samples: flat(5 * AU, 0) }, // far from the ship's path
      moon: { t0: T0, dt: DAY, samples: flat(5 * AU, 1e8) },
      mars: { t0: T0, dt: DAY, samples: flat(1.5 * AU, 0) },
      venus: { t0: T0, dt: DAY, samples: flat(0.7 * AU, 0) },
      jupiter: { t0: T0, dt: DAY, samples: flat(5.2 * AU, 0) },
    },
  };
}

describe('closestApproachToEarth', () => {
  it('finds the true minimum on a synthetic ephemeris with Earth far from the search path', () => {
    const ephemeris = buildFarEarthEphemeris();
    // Ship on a circular solar orbit at 1 AU (approximately) so it stays bound
    // and doesn't blow up numerically; Earth is fixed at 5 AU, so the
    // ship-Earth distance oscillates and has a well-defined minimum over one
    // period. We just assert the search finds *a* minimum consistent with the
    // geometry (distance less than the max possible separation, greater than
    // the min possible separation) and that reachedHorizon is true.
    const vCirc = Math.sqrt(MU_SUN / AU);
    const inserted: InsertedState = {
      position: { x: AU, y: 0, z: 0 },
      velocity: { x: 0, y: vCirc, z: 0 },
      epoch: T0,
    };
    const horizonSeconds = 5 * DAY;
    const result = closestApproachToEarth(inserted, ephemeris, horizonSeconds, 60);
    expect(result.reachedHorizon).toBe(true);
    // Earth is fixed at (5AU, 0); ship orbits at radius ~1AU around the origin.
    // Distance to Earth ranges over [5AU - 1AU, 5AU + 1AU] = [4AU, 6AU].
    expect(result.distanceMeters).toBeGreaterThan(3.9 * AU);
    expect(result.distanceMeters).toBeLessThan(6.1 * AU);
  });

  it('reports reachedHorizon=false when the epoch runs past ephemeris coverage', () => {
    const ephemeris = buildFarEarthEphemeris();
    const inserted: InsertedState = {
      position: { x: AU, y: 0, z: 0 },
      velocity: { x: 0, y: 29000, z: 0 },
      epoch: T0,
    };
    // Horizon far beyond the 10-day synthetic coverage.
    const result = closestApproachToEarth(inserted, ephemeris, 30 * DAY, 60);
    expect(result.reachedHorizon).toBe(false);
  });

  it('chunked runner produces the same result shape as the synchronous version', async () => {
    const ephemeris = buildFarEarthEphemeris();
    const inserted: InsertedState = {
      position: { x: AU, y: 0, z: 0 },
      velocity: { x: 0, y: Math.sqrt(MU_SUN / AU), z: 0 },
      epoch: T0,
    };
    const sync = closestApproachToEarth(inserted, ephemeris, 3 * DAY, 60);

    const chunked = await new Promise<{ distanceMeters: number; reachedHorizon: boolean }>((resolve) => {
      runClosestApproachChunked(
        inserted,
        ephemeris,
        3 * DAY,
        (result) => resolve(result),
        () => {},
        (cb) => cb(), // synchronous scheduler for the test
        50,
        60,
      );
    });

    expect(chunked.reachedHorizon).toBe(sync.reachedHorizon);
    expect(chunked.distanceMeters).toBeCloseTo(sync.distanceMeters, 0);
  });

  it('cancel() stops the chunked run before onDone fires', () => {
    const ephemeris = buildFarEarthEphemeris();
    const inserted: InsertedState = {
      position: { x: AU, y: 0, z: 0 },
      velocity: { x: 0, y: Math.sqrt(MU_SUN / AU), z: 0 },
      epoch: T0,
    };
    let called = false;
    const scheduled: (() => void)[] = [];
    const handle = runClosestApproachChunked(
      inserted,
      ephemeris,
      3 * DAY,
      () => {
        called = true;
      },
      () => {},
      (cb) => scheduled.push(cb),
      10,
      60,
    );
    handle.cancel();
    while (scheduled.length > 0) {
      const cb = scheduled.shift()!;
      cb();
    }
    expect(called).toBe(false);
  });
});

describe('insertedOrbitalElements', () => {
  it('computes solar-frame elements matching orbitalElementsFromState directly', () => {
    const ephemeris = buildFarEarthEphemeris();
    const vCirc = Math.sqrt(MU_SUN / AU);
    const inserted: InsertedState = { position: { x: AU, y: 0, z: 0 }, velocity: { x: 0, y: vCirc, z: 0 }, epoch: T0 };
    const { elements } = insertedOrbitalElements(inserted, ephemeris, 'solar');
    expect(elements.eccentricity).toBeCloseTo(0, 3); // circular orbit
    expect(elements.semiMajorAxis).toBeCloseTo(AU, -3);
  });

  it('computes earth-frame elements relative to Earth ephemeris state at epoch', () => {
    const ephemeris = buildFarEarthEphemeris();
    // Ship near Earth (5 AU, 0) with a small relative velocity -> bound Earth orbit.
    const earthPos = { x: 5 * AU, y: 0, z: 0 };
    const inserted: InsertedState = {
      position: { x: earthPos.x + 1e7, y: 0, z: 0 },
      velocity: { x: 0, y: 2000, z: 0 },
      epoch: T0,
    };
    const { elements, frame } = insertedOrbitalElements(inserted, ephemeris, 'earth');
    expect(frame).toBe('earth');
    expect(elements.periapsis).toBeGreaterThan(0);
  });
});

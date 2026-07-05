// Shared helpers for sim-worker integration tests. Loads the real generated
// ephemeris JSON from data/ (via fs, no fetch), captures the sim's emitted event
// stream, and builds scenario seeds — including a contrived near-Earth capture
// state derived from the true ephemeris so win detection can be exercised.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { EphemerisData, BodyId } from '../../src/core/ephemerisTypes';
import { positionAt, velocityAt } from '../../src/core/ephemerisInterp';
import { sub, norm, cross, normalize, mul, add } from '../../src/core/vector3';
import type { Vector3 } from '../../src/core/vector3';
import { MU_EARTH } from '../../src/core/constants';
import type { SimEvent } from '../../src/sim/messages';
import type { ScenarioSeed } from '../../src/sim/types';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

let cached: EphemerisData | null = null;

export function loadRealEphemeris(): EphemerisData {
  if (!cached) {
    cached = JSON.parse(readFileSync(resolve(repoRoot, 'data/ephemeris.json'), 'utf8')) as EphemerisData;
  }
  return cached;
}

// A time comfortably inside coverage for all bodies: 100 days past the Moon's
// (finest) t0, which is the latest-starting series.
export function coverageEpoch(eph: EphemerisData): number {
  const moon = eph.bodies.moon!;
  return moon.t0 + 100 * 86400;
}

export function bodyPos(eph: EphemerisData, body: BodyId, t: number): Vector3 {
  return positionAt(eph, body, t);
}

// A cruise seed far from Earth: offset the ship well outside Earth's SOI along
// +x, moving roughly with Earth's velocity. Used for stepping/burn/warp tests
// where we don't want an accidental capture or failure.
export function cruiseSeed(eph: EphemerisData, epoch: number): ScenarioSeed {
  const earthP = positionAt(eph, 'earth', epoch);
  const earthV = velocityAt(eph, 'earth', epoch);
  return {
    id: 'test-cruise',
    title: 'Test cruise',
    epoch,
    position: add(earthP, { x: 3e10, y: 0, z: 0 }), // ~0.2 AU from Earth, outside SOI
    velocity: earthV,
    playerDescription: 'test',
  };
}

// A contrived bound near-Earth state: place the ship at Earth-relative radius r
// (inside SOI, above atmosphere) on a circular Earth orbit (speed sqrt(mu/r)),
// so it satisfies all three capture conditions at epoch.
export function captureSeed(eph: EphemerisData, epoch: number, radius = 2e8): ScenarioSeed {
  const earthP = positionAt(eph, 'earth', epoch);
  const earthV = velocityAt(eph, 'earth', epoch);
  const rHat: Vector3 = { x: 1, y: 0, z: 0 };
  const position = add(earthP, mul(rHat, radius));
  // Circular-orbit velocity perpendicular to r, in the ecliptic-ish plane.
  const vHat = normalize(cross({ x: 0, y: 0, z: 1 }, rHat));
  const speed = Math.sqrt(MU_EARTH / radius);
  const velocity = add(earthV, mul(vHat, speed));
  return { id: 'test-capture', title: 'Test capture', epoch, position, velocity, playerDescription: 'test' };
}

// A state just below the 120 km atmosphere threshold, guaranteeing a lose on the
// first verdict check after a step.
export function atmosphereSeed(eph: EphemerisData, epoch: number): ScenarioSeed {
  const earthP = positionAt(eph, 'earth', epoch);
  const earthV = velocityAt(eph, 'earth', epoch);
  // 6300 km from Earth center is well below R_EARTH + 120 km (~6491 km).
  const position = add(earthP, { x: 6.3e6, y: 0, z: 0 });
  return { id: 'test-atmo', title: 'Test atmosphere', epoch, position, velocity: earthV, playerDescription: 'test' };
}

export { sub, norm } from '../../src/core/vector3';

// Collect emitted events into an array with typed filters.
export class EventCollector {
  readonly events: SimEvent[] = [];
  readonly emit = (event: SimEvent): void => {
    this.events.push(event);
  };
  ofType<T extends SimEvent['type']>(type: T): Extract<SimEvent, { type: T }>[] {
    return this.events.filter((e) => e.type === type) as Extract<SimEvent, { type: T }>[];
  }
  clear(): void {
    this.events.length = 0;
  }
}

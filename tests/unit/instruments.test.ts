import { describe, expect, it } from 'vitest';
import {
  radioLockEarth,
  sunDirection,
  starAttitude,
  angularSeparation,
  MeasurementLog,
} from '../../src/sim/instruments';
import { positionAt } from '../../src/core/ephemerisInterp';
import { solveEmissionTime, apparentDirection } from '../../src/core/lightTime';
import { C } from '../../src/core/constants';
import type { EphemerisData } from '../../src/core/ephemerisTypes';
import { sub, norm, normalize, angleBetween } from '../../src/core/vector3';
import { loadRealEphemeris, coverageEpoch } from './simHelpers';

const eph = loadRealEphemeris();
const epoch = coverageEpoch(eph);

describe('radioLockEarth light-time (§7.2)', () => {
  it('matches a hand-computed light-time correction from the real ephemeris', () => {
    // Ship far from Earth so the light-time is many seconds and clearly nonzero.
    const earthNow = positionAt(eph, 'earth', epoch);
    const ship = { x: earthNow.x + 4e10, y: earthNow.y + 2e10, z: earthNow.z };
    const lock = radioLockEarth(eph, ship, epoch);

    // Independent recomputation via the core emission solver.
    const sol = solveEmissionTime((t) => positionAt(eph, 'earth', t), ship, epoch);
    expect(lock.tSent).toBeCloseTo(sol.tEmit, 6);
    expect(lock.rangeMeters).toBeCloseTo(sol.lightTime * C, 3);
    // Range equals the geometric distance to Earth-at-emit (within tolerance).
    expect(lock.rangeMeters).toBeCloseTo(sol.distance, 0);
    // Direction points at Earth's emit-time position, not its now position.
    // (Compare components directly; angleBetween(a,a) is an unclamped acos that
    // can NaN for coincident unit vectors — see the core inbox note.)
    const emitDir = normalize(sub(sol.position, ship));
    expect(lock.direction.x).toBeCloseTo(emitDir.x, 9);
    expect(lock.direction.y).toBeCloseTo(emitDir.y, 9);
    expect(lock.direction.z).toBeCloseTo(emitDir.z, 9);
    // The emit-time direction differs measurably from the now-time direction.
    const nowDir = normalize(sub(earthNow, ship));
    expect(angleBetween(lock.direction, nowDir)).toBeGreaterThan(0);
    expect(lock.quality).toBe(1);
    expect(lock.tReceived).toBe(epoch);
  });

  it('reports geometric range when emission time clamps at ephemeris start', () => {
    const t0 = 1_000;
    const earth = { x: 1e9, y: 0, z: 0 };
    const edgeEphemeris: EphemerisData = {
      frame: eph.frame,
      units: eph.units,
      bodies: {
        earth: {
          t0,
          dt: 60,
          samples: [
            [earth.x, earth.y, earth.z, 0, 0, 0],
            [earth.x, earth.y, earth.z, 0, 0, 0],
          ],
        },
      },
    };
    const ship = { x: earth.x + 12 * C, y: 0, z: 0 };

    const lock = radioLockEarth(edgeEphemeris, ship, t0);

    expect(lock.tSent).toBe(t0);
    expect(lock.tReceived).toBe(t0);
    expect(lock.rangeMeters).toBeCloseTo(12 * C, 3);
  });
});

describe('sunDirection (§7.5)', () => {
  it('is the exact unit vector from ship to Sun now', () => {
    const ship = { x: 1e10, y: -2e10, z: 5e9 };
    const data = sunDirection(eph, ship, epoch);
    const expected = normalize(sub(positionAt(eph, 'sun', epoch), ship));
    expect(norm(data.direction)).toBeCloseTo(1, 12);
    expect(angleBetween(data.direction, expected)).toBeLessThan(1e-12);
  });
});

describe('starAttitude (§7.3)', () => {
  it('returns the ship forward vector verbatim', () => {
    const fwd = { x: 0, y: 0, z: 1 };
    expect(starAttitude(fwd).forward).toEqual(fwd);
  });
});

describe('angularSeparation (§7.1)', () => {
  it('returns a value in [0, π] between distinct bodies matching a hand calc', () => {
    const ship = { x: 1e11, y: 3e10, z: 1e9 };
    const sep = angularSeparation(eph, ship, epoch, 'earth', 'sun').radians;
    expect(sep).toBeGreaterThanOrEqual(0);
    expect(sep).toBeLessThanOrEqual(Math.PI);
    // Independent recompute via apparent directions + a clamped dot product.
    const eDir = apparentDirection((t) => positionAt(eph, 'earth', t), ship, epoch).direction;
    const sDir = apparentDirection((t) => positionAt(eph, 'sun', t), ship, epoch).direction;
    const d = eDir.x * sDir.x + eDir.y * sDir.y + eDir.z * sDir.z;
    expect(sep).toBeCloseTo(Math.acos(Math.min(1, Math.max(-1, d))), 9);
  });
});

describe('MeasurementLog (§7.5)', () => {
  it('appends with monotonic ids + timestamps, supports notes, resets', () => {
    const log = new MeasurementLog();
    const a = log.add(1000, { kind: 'sunDirection', direction: { x: 1, y: 0, z: 0 } });
    const b = log.add(1050, { kind: 'starAttitude', forward: { x: 0, y: 1, z: 0 } });
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(log.all()).toHaveLength(2);

    const noted = log.annotate(1, 'first fix');
    expect(noted?.note).toBe('first fix');
    expect(log.all()[0]!.note).toBe('first fix');
    expect(log.annotate(999, 'x')).toBeNull();

    log.reset();
    expect(log.all()).toHaveLength(0);
    expect(log.add(2000, { kind: 'sunDirection', direction: { x: 0, y: 0, z: 1 } }).id).toBe(1);
  });
});

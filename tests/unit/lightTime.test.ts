import { describe, expect, it } from 'vitest';
import { solveEmissionTime, apparentDirection, TOL_S } from '../../src/core/lightTime';
import { C } from '../../src/core/constants';
import { norm, sub } from '../../src/core/vector3';

describe('solveEmissionTime', () => {
  it('is exact for a stationary body (light-time = distance / c)', () => {
    const bodyPos = { x: 3e11, y: 0, z: 0 };
    const ship = { x: 0, y: 0, z: 0 };
    const sol = solveEmissionTime(() => bodyPos, ship, 1_000_000);
    expect(sol.lightTime).toBeCloseTo(3e11 / C, 6);
    expect(sol.tEmit).toBeCloseTo(1_000_000 - 3e11 / C, 6);
    expect(sol.distance).toBeCloseTo(3e11, 3);
  });

  it('solves the implicit equation for a body moving at constant velocity', () => {
    // Body position b(t) = b0 + v*(t - tNow). Verify the converged solution
    // satisfies |b(t_emit) - ship| = c*(tNow - t_emit) analytically.
    const tNow = 5_000_000;
    const b0 = { x: 4e11, y: 1e11, z: -2e10 };
    const v = { x: -30_000, y: 12_000, z: 0 }; // ~32 km/s, well below c
    const ship = { x: 0, y: 0, z: 0 };
    const bodyAt = (t: number) => ({
      x: b0.x + v.x * (t - tNow),
      y: b0.y + v.y * (t - tNow),
      z: b0.z + v.z * (t - tNow),
    });
    const sol = solveEmissionTime(bodyAt, ship, tNow);
    const residual = sol.distance - C * (tNow - sol.tEmit);
    // Residual as a light-time error must be under the tolerance.
    expect(Math.abs(residual) / C).toBeLessThan(TOL_S);
    // And the reported position is the body at the emission time.
    const bEmit = bodyAt(sol.tEmit);
    expect(norm(sub(sol.position, bEmit))).toBeLessThan(1);
  });

  it('gives zero light-time when the body sits on the ship', () => {
    const sol = solveEmissionTime(() => ({ x: 0, y: 0, z: 0 }), { x: 0, y: 0, z: 0 }, 42);
    expect(sol.lightTime).toBe(0);
    expect(sol.distance).toBe(0);
  });

  it('clamps emission sampling to the lower coverage bound', () => {
    const min = 90;
    const max = 200;
    const tNow = 100;
    const bodyAt = (t: number) => {
      if (t < min || t > max) {
        throw new Error(`outside coverage: ${t}`);
      }
      return { x: 30 * C, y: 0, z: 0 };
    };

    const sol = solveEmissionTime(bodyAt, { x: 0, y: 0, z: 0 }, tNow, { min, max });

    expect(sol.tEmit).toBe(min);
    expect(sol.lightTime).toBeCloseTo(30, 12);
    expect(sol.distance).toBeCloseTo(30 * C, 3);
  });

  it('reports geometric light-time when clamped at the receive-time boundary', () => {
    const min = 100;
    const bodyAt = (t: number) => {
      if (t < min) {
        throw new Error(`outside coverage: ${t}`);
      }
      return { x: 12 * C, y: 0, z: 0 };
    };

    const sol = solveEmissionTime(bodyAt, { x: 0, y: 0, z: 0 }, min, { min, max: 200 });

    expect(sol.tEmit).toBe(min);
    expect(sol.lightTime).toBeCloseTo(12, 12);
    expect(sol.distance).toBeCloseTo(12 * C, 3);
  });
});

describe('apparentDirection', () => {
  it('returns a unit vector toward the emission-time position', () => {
    const bodyPos = { x: 0, y: 3e11, z: 0 };
    const ap = apparentDirection(() => bodyPos, { x: 0, y: 0, z: 0 }, 1e6);
    expect(norm(ap.direction)).toBeCloseTo(1, 9);
    expect(ap.direction.y).toBeCloseTo(1, 9);
    expect(ap.distance).toBeCloseTo(3e11, 3);
    expect(ap.lightTime).toBeCloseTo(3e11 / C, 6);
  });

  it('returns the zero vector when body and ship coincide', () => {
    const ap = apparentDirection(() => ({ x: 5, y: 5, z: 5 }), { x: 5, y: 5, z: 5 }, 0);
    expect(ap.direction).toEqual({ x: 0, y: 0, z: 0 });
    expect(ap.distance).toBe(0);
  });
});

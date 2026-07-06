import { describe, expect, it } from 'vitest';
import { gravityAcceleration } from '../../src/core/gravity';
import { MU_SUN, MU_EARTH, MU_MOON } from '../../src/core/constants';
import { norm } from '../../src/core/vector3';

const ORIGIN = { x: 0, y: 0, z: 0 };

describe('gravityAcceleration', () => {
  it('points from the ship toward a single dominant body', () => {
    const d = 1e7;
    const bodies = { sun: { x: 1e15, y: 0, z: 0 }, earth: { x: d, y: 0, z: 0 }, moon: { x: -1e12, y: 0, z: 0 } };
    const a = gravityAcceleration(ORIGIN, bodies);
    expect(a.x).toBeGreaterThan(0);
    expect(Math.abs(a.y)).toBeLessThan(Math.abs(a.x) * 1e-6);
    expect(Math.abs(a.z)).toBeLessThan(Math.abs(a.x) * 1e-6);
  });

  it('matches the closed-form magnitude for a single dominant body (mu/r^2)', () => {
    const d = 4e8;
    const bodies = { sun: { x: 1e18, y: 0, z: 0 }, earth: { x: d, y: 0, z: 0 }, moon: { x: 1e18, y: 0, z: 0 } };
    const a = gravityAcceleration(ORIGIN, bodies);
    const expected = MU_EARTH / (d * d);
    expect(norm(a)).toBeGreaterThan(expected * 0.9999);
    expect(norm(a)).toBeLessThan(expected * 1.0001);
  });

  it('sums Sun + Earth + Moon contributions linearly', () => {
    const ship = { x: 1e8, y: 2e8, z: -3e7 };
    const bodies = {
      sun: { x: 0, y: 0, z: 0 },
      earth: { x: 1.5e11, y: 0, z: 0 },
      moon: { x: 1.5e11 + 3.8e8, y: 0, z: 0 },
    };
    const total = gravityAcceleration(ship, bodies);

    const term = (bp: { x: number; y: number; z: number }, mu: number) => {
      const dx = bp.x - ship.x;
      const dy = bp.y - ship.y;
      const dz = bp.z - ship.z;
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const f = mu / (r * r * r);
      return { x: dx * f, y: dy * f, z: dz * f };
    };
    const s = term(bodies.sun, MU_SUN);
    const e = term(bodies.earth, MU_EARTH);
    const m = term(bodies.moon, MU_MOON);
    expect(total.x).toBeCloseTo(s.x + e.x + m.x, 12);
    expect(total.y).toBeCloseTo(s.y + e.y + m.y, 12);
    expect(total.z).toBeCloseTo(s.z + e.z + m.z, 12);
  });

  it('ignores a body exactly coincident with the ship instead of producing NaN', () => {
    const bodies = {
      sun: ORIGIN,
      earth: { x: 1e7, y: 0, z: 0 },
      moon: { x: -1e7, y: 0, z: 0 },
    };
    const a = gravityAcceleration(ORIGIN, bodies);

    expect(Number.isFinite(a.x)).toBe(true);
    expect(Number.isFinite(a.y)).toBe(true);
    expect(Number.isFinite(a.z)).toBe(true);
    expect(a.x).toBeCloseTo(MU_EARTH / 1e14 - MU_MOON / 1e14, 12);
    expect(a.y).toBe(0);
    expect(a.z).toBe(0);
  });
});

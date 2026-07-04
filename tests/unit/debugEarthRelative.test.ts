import { describe, expect, it } from 'vitest';
import { computeEarthRelativeState } from '../../src/ui/debug/earthRelative';
import { MU_EARTH, R_EARTH, R_SOI_EARTH } from '../../src/core/constants';

describe('computeEarthRelativeState (§10, §2.1 win-condition ingredients)', () => {
  it('computes a bound circular low-orbit state as inside SOI, bound, above the surface', () => {
    const earthPos = { x: 1e11, y: 0, z: 0 };
    const earthVel = { x: 0, y: 30000, z: 0 };
    const radius = R_EARTH + 500_000; // 500 km altitude
    const shipPos = { x: earthPos.x + radius, y: earthPos.y, z: earthPos.z };
    const speed = Math.sqrt(MU_EARTH / radius); // circular orbit speed
    const shipVel = { x: earthVel.x, y: earthVel.y + speed, z: earthVel.z };

    const rel = computeEarthRelativeState(shipPos, shipVel, earthPos, earthVel);
    expect(rel.distance).toBeCloseTo(radius, 3);
    expect(rel.speed).toBeCloseTo(speed, 3);
    expect(rel.specificEnergy).toBeLessThan(0);
    expect(rel.bound).toBe(true);
    expect(rel.insideSOI).toBe(true);
    expect(rel.altitude).toBeCloseTo(500_000, 3);
  });

  it('flags a state outside the SOI as not inside SOI', () => {
    const earthPos = { x: 0, y: 0, z: 0 };
    const earthVel = { x: 0, y: 0, z: 0 };
    const shipPos = { x: R_SOI_EARTH * 2, y: 0, z: 0 };
    const shipVel = { x: 0, y: 1000, z: 0 };
    const rel = computeEarthRelativeState(shipPos, shipVel, earthPos, earthVel);
    expect(rel.insideSOI).toBe(false);
  });

  it('flags a high-speed flyby as unbound (positive specific energy)', () => {
    const earthPos = { x: 0, y: 0, z: 0 };
    const earthVel = { x: 0, y: 0, z: 0 };
    const radius = R_EARTH + 500_000;
    const shipPos = { x: radius, y: 0, z: 0 };
    // Far above escape velocity at this radius.
    const shipVel = { x: 0, y: 50000, z: 0 };
    const rel = computeEarthRelativeState(shipPos, shipVel, earthPos, earthVel);
    expect(rel.specificEnergy).toBeGreaterThan(0);
    expect(rel.bound).toBe(false);
  });

  it('altitude is negative below the surface radius', () => {
    const earthPos = { x: 0, y: 0, z: 0 };
    const earthVel = { x: 0, y: 0, z: 0 };
    const shipPos = { x: R_EARTH - 1000, y: 0, z: 0 };
    const shipVel = { x: 0, y: 0, z: 0 };
    const rel = computeEarthRelativeState(shipPos, shipVel, earthPos, earthVel);
    expect(rel.altitude).toBeCloseTo(-1000, 3);
  });
});

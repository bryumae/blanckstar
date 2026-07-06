import { describe, expect, it } from 'vitest';
import { isCaptured, failureCheck } from '../../src/core/winLose';
import type { State } from '../../src/core/rk4';
import { MU_EARTH, R_EARTH, R_MOON, R_SUN, MIN_SAFE_ALTITUDE } from '../../src/core/constants';

const earth: State = { position: { x: 1.5e11, y: 0, z: 0 }, velocity: { x: 0, y: 29_780, z: 0 } };

// Build a ship state at a given Earth-centered radius on a bound (circular)
// Earth orbit, in Earth's moving frame.
function boundShipAtRadius(r: number): State {
  const vc = Math.sqrt(MU_EARTH / r);
  return {
    position: { x: earth.position.x + r, y: 0, z: 0 },
    velocity: { x: 0, y: earth.velocity.y + vc, z: 0 },
  };
}

describe('isCaptured', () => {
  it('is true for a bound orbit inside the SOI above the atmosphere', () => {
    const ship = boundShipAtRadius(R_EARTH + 500_000); // 500 km altitude
    expect(isCaptured(ship, earth)).toBe(true);
  });

  it('is false when outside the sphere of influence', () => {
    const ship = boundShipAtRadius(2e9); // > R_SOI_EARTH (~0.929e9)
    expect(isCaptured(ship, earth)).toBe(false);
  });

  it('is false when Earth-relative energy is not negative (hyperbolic flyby)', () => {
    const r = R_EARTH + 500_000;
    const vEsc = Math.sqrt((2 * MU_EARTH) / r);
    const ship: State = {
      position: { x: earth.position.x + r, y: 0, z: 0 },
      velocity: { x: 0, y: earth.velocity.y + vEsc * 1.1, z: 0 },
    };
    expect(isCaptured(ship, earth)).toBe(false);
  });

  it('is false when altitude is at/below the 120 km atmosphere floor', () => {
    // Bound and inside SOI, but altitude exactly 120 km -> not strictly above.
    const ship = boundShipAtRadius(R_EARTH + MIN_SAFE_ALTITUDE);
    expect(isCaptured(ship, earth)).toBe(false);
    const just = boundShipAtRadius(R_EARTH + MIN_SAFE_ALTITUDE + 1);
    expect(isCaptured(just, earth)).toBe(true);
  });
});

describe('failureCheck', () => {
  const moon = { x: earth.position.x + 3.8e8, y: 0, z: 0 };
  const sun = { x: 0, y: 0, z: 0 };

  it('returns null for a healthy ship well above all surfaces', () => {
    const ship = { x: earth.position.x + R_EARTH + 500_000, y: 0, z: 0 };
    expect(failureCheck(ship, earth.position, moon, sun)).toBeNull();
  });

  it('detects atmospheric entry at or below 120 km', () => {
    const ship = { x: earth.position.x + R_EARTH + MIN_SAFE_ALTITUDE, y: 0, z: 0 };
    expect(failureCheck(ship, earth.position, moon, sun)).toBe('earth-atmosphere');
  });

  it('detects a lunar surface collision', () => {
    // Below Moon surface radius but far from Earth (no false atmosphere trip).
    const ship = { x: moon.x + R_MOON - 100, y: 0, z: 0 };
    expect(failureCheck(ship, earth.position, moon, sun)).toBe('moon-collision');
  });

  it('detects a solar collision within 2 solar radii', () => {
    const ship = { x: 1.5 * R_SUN, y: 0, z: 0 };
    expect(failureCheck(ship, earth.position, moon, sun)).toBe('sun-collision');
  });

  it('prioritizes atmosphere over other collisions', () => {
    // Ship below atmosphere AND (impossibly) also near the Moon: atmosphere wins.
    const nearEarthAndMoon = { x: earth.position.x + R_EARTH, y: 0, z: 0 };
    const moonOnShip = nearEarthAndMoon;
    expect(failureCheck(nearEarthAndMoon, earth.position, moonOnShip, sun)).toBe('earth-atmosphere');
  });
});

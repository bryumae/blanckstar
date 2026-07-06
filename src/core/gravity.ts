// Sun + Earth + Moon point-mass gravity on a massless test-particle ship
// (mvp0_spec.md §4.3). Mars/Venus/Jupiter are visible but exert no force.
//   a_body = mu_body * (r_body - r_ship) / |r_body - r_ship|^3
//   a_gravity = a_sun + a_earth + a_moon
import type { Vector3 } from './vector3';
import { MU_SUN, MU_EARTH, MU_MOON } from './constants';

export interface GravitatingBodies {
  readonly sun: Vector3;
  readonly earth: Vector3;
  readonly moon: Vector3;
}

// Acceleration from a single body at bodyPosition with gravitational parameter mu.
function accelerationFrom(shipPosition: Vector3, bodyPosition: Vector3, mu: number): Vector3 {
  const dx = bodyPosition.x - shipPosition.x;
  const dy = bodyPosition.y - shipPosition.y;
  const dz = bodyPosition.z - shipPosition.z;
  const r2 = dx * dx + dy * dy + dz * dz;
  if (r2 === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  const r = Math.sqrt(r2);
  const factor = mu / (r2 * r); // mu / r^3
  return { x: dx * factor, y: dy * factor, z: dz * factor };
}

export function gravityAcceleration(shipPosition: Vector3, bodyPositions: GravitatingBodies): Vector3 {
  const aSun = accelerationFrom(shipPosition, bodyPositions.sun, MU_SUN);
  const aEarth = accelerationFrom(shipPosition, bodyPositions.earth, MU_EARTH);
  const aMoon = accelerationFrom(shipPosition, bodyPositions.moon, MU_MOON);
  return {
    x: aSun.x + aEarth.x + aMoon.x,
    y: aSun.y + aEarth.y + aMoon.y,
    z: aSun.z + aEarth.z + aMoon.z,
  };
}

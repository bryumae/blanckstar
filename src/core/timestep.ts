// Tiered integrator timestep selection (mvp0_spec.md §4.4). dt is chosen by the
// ship's distance to the nearest gravitating body (Earth/Moon/Sun):
//   d > 1e9 m          heliocentric cruise    dt = 60 s
//   1e7 m <= d <= 1e9  Earth/Moon approach     dt = 10 s
//   d < 1e7 m          close orbit             dt = 1 s
// Time warp runs physics substeps at these dt values, never one large step.
import type { Vector3 } from './vector3';
import { sub, norm } from './vector3';
import type { GravitatingBodies } from './gravity';

export const DT_CRUISE = 60; // s
export const DT_APPROACH = 10; // s
export const DT_CLOSE = 1; // s

export const DIST_CRUISE = 1e9; // m; above this -> cruise
export const DIST_CLOSE = 1e7; // m; below this -> close

// dt from a raw distance to the nearest gravitating body.
export function timestepForDistance(distance: number): number {
  if (distance > DIST_CRUISE) {
    return DT_CRUISE;
  }
  if (distance < DIST_CLOSE) {
    return DT_CLOSE;
  }
  return DT_APPROACH;
}

// Distance from the ship to the nearest gravitating body (Sun/Earth/Moon).
export function nearestBodyDistance(shipPosition: Vector3, bodies: GravitatingBodies): number {
  const dSun = norm(sub(bodies.sun, shipPosition));
  const dEarth = norm(sub(bodies.earth, shipPosition));
  const dMoon = norm(sub(bodies.moon, shipPosition));
  return Math.min(dSun, dEarth, dMoon);
}

// dt for the ship's current position given the gravitating-body positions.
export function selectTimestep(shipPosition: Vector3, bodies: GravitatingBodies): number {
  return timestepForDistance(nearestBodyDistance(shipPosition, bodies));
}

// Given the current time, a chosen dt, and a list of event boundary times (burn
// start/end, target time), return the step to actually take so no step crosses a
// boundary — a boundary always lands exactly on a step edge (§4.4). If the next
// boundary strictly ahead is closer than dt, the step is shortened to land on
// it. Boundaries at or before `now` are ignored. Never returns a non-positive
// step; if a boundary sits exactly at `now` it is skipped (the caller has
// already reached it).
export function stepToBoundary(now: number, dt: number, boundaries: readonly number[]): number {
  let nextBoundary = Infinity;
  for (const b of boundaries) {
    if (b > now && b < nextBoundary) {
      nextBoundary = b;
    }
  }
  const untilBoundary = nextBoundary - now;
  return untilBoundary < dt ? untilBoundary : dt;
}

// Light-time emission solver (mvp0_spec.md §7.1, §7.2). Light seen at the ship
// at receive time t_now was emitted earlier, when the body was at an earlier
// position. Solve for t_emit such that the light-travel distance equals the
// geometric distance at that emission instant:
//
//   |body_pos(t_emit) - ship_pos| = c * (t_now - t_emit)
//
// Fixed-point iteration: t_emit <- t_now - |body_pos(t_emit) - ship_pos| / c.
// This is a contraction (bodies move far slower than c), converging in a few
// rounds. We iterate until the light-time changes by less than TOL_S between
// rounds — a light-time tolerance well under 1 ms — then one final round to
// pin the position. The ship is treated as stationary over the (sub-second to
// few-minutes) light-time window: at receive time the sky is drawn from a
// single ship position (§7.1 "no position readout", fixed sky).
import type { Vector3 } from './vector3';
import { sub, norm } from './vector3';
import { C } from './constants';

// Convergence tolerance on light-time (seconds). 1e-6 s corresponds to ~300 m of
// light-travel distance — comfortably under the 1 ms budget in the brief.
export const TOL_S = 1e-6;
const MAX_ITERS = 50;

export interface EmissionSolution {
  readonly tEmit: number; // emission sample time (unix seconds; clamped to bounds when provided)
  readonly lightTime: number; // geometric signal time, distance / c (seconds)
  readonly position: Vector3; // body position at t_emit
  readonly distance: number; // |body_pos(t_emit) - ship_pos| (meters)
}

export interface EmissionTimeBounds {
  readonly min?: number;
  readonly max?: number;
}

// Solve for the emission time of light arriving at shipPosition at receive time
// tNow, given a function returning the body's position at any time. When bounds
// are provided, iteration samples only inside that time interval; this lets
// ephemeris-backed callers degrade at coverage edges instead of throwing.
export function solveEmissionTime(
  bodyPositionAt: (t: number) => Vector3,
  shipPosition: Vector3,
  tNow: number,
  bounds: EmissionTimeBounds = {},
): EmissionSolution {
  let tEmit = clamp(tNow, bounds.min ?? -Infinity, bounds.max ?? Infinity);
  let position = bodyPositionAt(tEmit);
  let distance = norm(sub(position, shipPosition));

  for (let i = 0; i < MAX_ITERS; i++) {
    position = bodyPositionAt(tEmit);
    distance = norm(sub(position, shipPosition));
    const nextTEmit = clamp(tNow - distance / C, bounds.min ?? -Infinity, bounds.max ?? Infinity);
    if (Math.abs(nextTEmit - tEmit) < TOL_S) {
      tEmit = nextTEmit;
      // Refresh position/distance at the converged or clamped emission time.
      position = bodyPositionAt(tEmit);
      distance = norm(sub(position, shipPosition));
      break;
    }
    tEmit = nextTEmit;
  }

  return { tEmit, lightTime: distance / C, position, distance };
}

export interface ApparentDirection {
  readonly direction: Vector3; // unit vector from ship toward the body at emission
  readonly distance: number; // meters
  readonly tEmit: number; // emission sample time
  readonly lightTime: number; // seconds
}

// Apparent (light-time-corrected) direction and distance to a body as seen from
// the ship at receive time tNow. Direction is a unit vector in the inertial
// frame. If ship and body coincide (distance 0) the direction is the zero vector.
export function apparentDirection(
  bodyPositionAt: (t: number) => Vector3,
  shipPosition: Vector3,
  tNow: number,
  bounds: EmissionTimeBounds = {},
): ApparentDirection {
  const sol = solveEmissionTime(bodyPositionAt, shipPosition, tNow, bounds);
  const d = sub(sol.position, shipPosition);
  const direction =
    sol.distance === 0 ? { x: 0, y: 0, z: 0 } : { x: d.x / sol.distance, y: d.y / sol.distance, z: d.z / sol.distance };
  return { direction, distance: sol.distance, tEmit: sol.tEmit, lightTime: sol.lightTime };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

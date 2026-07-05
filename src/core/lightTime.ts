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
  readonly tEmit: number; // emission time (unix seconds)
  readonly lightTime: number; // t_now - t_emit (seconds)
  readonly position: Vector3; // body position at t_emit
  readonly distance: number; // |body_pos(t_emit) - ship_pos| (meters)
}

// Solve for the emission time of light arriving at shipPosition at receive time
// tNow, given a function returning the body's position at any time.
export function solveEmissionTime(
  bodyPositionAt: (t: number) => Vector3,
  shipPosition: Vector3,
  tNow: number,
): EmissionSolution {
  let lightTime = 0; // first guess: emission == reception
  let position = bodyPositionAt(tNow);
  let distance = norm(sub(position, shipPosition));

  for (let i = 0; i < MAX_ITERS; i++) {
    const tEmit = tNow - lightTime;
    position = bodyPositionAt(tEmit);
    distance = norm(sub(position, shipPosition));
    const nextLightTime = distance / C;
    if (Math.abs(nextLightTime - lightTime) < TOL_S) {
      lightTime = nextLightTime;
      // Refresh position/distance at the converged emission time.
      position = bodyPositionAt(tNow - lightTime);
      distance = norm(sub(position, shipPosition));
      break;
    }
    lightTime = nextLightTime;
  }

  return { tEmit: tNow - lightTime, lightTime, position, distance };
}

export interface ApparentDirection {
  readonly direction: Vector3; // unit vector from ship toward the body at emission
  readonly distance: number; // meters
  readonly tEmit: number; // emission time
  readonly lightTime: number; // seconds
}

// Apparent (light-time-corrected) direction and distance to a body as seen from
// the ship at receive time tNow. Direction is a unit vector in the inertial
// frame. If ship and body coincide (distance 0) the direction is the zero vector.
export function apparentDirection(
  bodyPositionAt: (t: number) => Vector3,
  shipPosition: Vector3,
  tNow: number,
): ApparentDirection {
  const sol = solveEmissionTime(bodyPositionAt, shipPosition, tNow);
  const d = sub(sol.position, shipPosition);
  const direction =
    sol.distance === 0 ? { x: 0, y: 0, z: 0 } : { x: d.x / sol.distance, y: d.y / sol.distance, z: d.z / sol.distance };
  return { direction, distance: sol.distance, tEmit: sol.tEmit, lightTime: sol.lightTime };
}

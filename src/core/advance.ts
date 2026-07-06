// Shared acceleration-composition + one-substep RK4 advance (gravity from
// Sun+Earth+Moon plus commanded engine thrust). Pure core logic so the sim
// worker, the sandbox worker, and UI predictors all share one implementation
// instead of copying it (see issue #17: predictor-parity fixes in PR #14
// worked around a divergence caused by this duplication).
import type { State, Acceleration } from './rk4';
import { rk4Step } from './rk4';
import type { EphemerisData } from './ephemerisTypes';
import { positionAt } from './ephemerisInterp';
import { gravityAcceleration } from './gravity';
import type { GravitatingBodies } from './gravity';
import type { Vector3 } from './vector3';

// Gravitating-body positions sampled at time t (§4.3: Sun+Earth+Moon only).
export function gravitatingBodiesAt(ephemeris: EphemerisData, t: number): GravitatingBodies {
  return {
    sun: positionAt(ephemeris, 'sun', t),
    earth: positionAt(ephemeris, 'earth', t),
    moon: positionAt(ephemeris, 'moon', t),
  };
}

// Acceleration callback for one substep. Gravity is sampled at the RK4 stage
// time t (bodies move); the engine term is a constant thrust vector held over
// the whole substep — burns are snapped to step boundaries (§4.4) so throttle
// and forward never change mid-substep. `thrust` is the full engine
// acceleration vector (throttle * maxAccel * forward), or zero when not burning.
export function makeAcceleration(ephemeris: EphemerisData, thrust: Vector3): Acceleration {
  return (state: State, t: number): Vector3 => {
    const g = gravityAcceleration(state.position, gravitatingBodiesAt(ephemeris, t));
    return { x: g.x + thrust.x, y: g.y + thrust.y, z: g.z + thrust.z };
  };
}

// Advance one RK4 substep of size dt starting at time t with a fixed thrust.
export function advance(
  ephemeris: EphemerisData,
  state: State,
  t: number,
  dt: number,
  thrust: Vector3,
): State {
  return rk4Step(state, t, dt, makeAcceleration(ephemeris, thrust));
}

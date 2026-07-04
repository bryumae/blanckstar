// Fixed-step RK4 integrator (mvp0_spec.md §4.4). Shared by the live simulation,
// time warp, skip-to-time, and the trajectory predictor — feeding the true state
// makes the predictor exact. Deterministic: identical inputs produce
// bit-identical outputs (no time-dependent or random terms).
import type { Vector3 } from './vector3';
import { add, mul } from './vector3';

export interface State {
  readonly position: Vector3;
  readonly velocity: Vector3;
}

// Acceleration as a function of state and absolute time t (seconds). Time is
// passed so accelerations that depend on moving ephemeris bodies can sample the
// correct instant at each RK4 stage.
export type Acceleration = (state: State, t: number) => Vector3;

// Derivative of the state: dposition/dt = velocity, dvelocity/dt = acceleration.
function derivative(state: State, t: number, accel: Acceleration): State {
  return { position: state.velocity, velocity: accel(state, t) };
}

function addScaled(state: State, k: State, dt: number): State {
  return {
    position: add(state.position, mul(k.position, dt)),
    velocity: add(state.velocity, mul(k.velocity, dt)),
  };
}

// One classical RK4 step of size dt starting at time t.
export function rk4Step(state: State, t: number, dt: number, accel: Acceleration): State {
  const k1 = derivative(state, t, accel);
  const k2 = derivative(addScaled(state, k1, dt / 2), t + dt / 2, accel);
  const k3 = derivative(addScaled(state, k2, dt / 2), t + dt / 2, accel);
  const k4 = derivative(addScaled(state, k3, dt), t + dt, accel);

  const dt6 = dt / 6;
  return {
    position: {
      x: state.position.x + dt6 * (k1.position.x + 2 * k2.position.x + 2 * k3.position.x + k4.position.x),
      y: state.position.y + dt6 * (k1.position.y + 2 * k2.position.y + 2 * k3.position.y + k4.position.y),
      z: state.position.z + dt6 * (k1.position.z + 2 * k2.position.z + 2 * k3.position.z + k4.position.z),
    },
    velocity: {
      x: state.velocity.x + dt6 * (k1.velocity.x + 2 * k2.velocity.x + 2 * k3.velocity.x + k4.velocity.x),
      y: state.velocity.y + dt6 * (k1.velocity.y + 2 * k2.velocity.y + 2 * k3.velocity.y + k4.velocity.y),
      z: state.velocity.z + dt6 * (k1.velocity.z + 2 * k2.velocity.z + 2 * k3.velocity.z + k4.velocity.z),
    },
  };
}

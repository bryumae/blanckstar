// TODO(mvp0_spec.md §4.4): fixed-step RK4 integrator, shared by live simulation,
// time warp, skip-to-time, and the trajectory predictor. Not implemented yet —
// scaffolding only.
import type { Vector3 } from './vector3';

export interface State {
  readonly position: Vector3;
  readonly velocity: Vector3;
}

export type Acceleration = (state: State, t: number) => Vector3;

export function rk4Step(_state: State, _t: number, _dt: number, _accel: Acceleration): State {
  throw new Error('not implemented');
}

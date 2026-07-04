// TODO(mvp0_spec.md §4.3): Sun + Earth + Moon point-mass gravity on a massless
// ship. a_body = mu_body * (r_body - r_ship) / |r_body - r_ship|^3. Not
// implemented yet — scaffolding only.
import type { Vector3 } from './vector3';

export function gravityAcceleration(
  _shipPosition: Vector3,
  _bodyPositions: { sun: Vector3; earth: Vector3; moon: Vector3 },
): Vector3 {
  throw new Error('not implemented');
}

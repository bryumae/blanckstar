// TODO(mvp0_spec.md §7 "Inserted-state orbital information"): derive classical
// orbital elements (periapsis/apoapsis as center-distance, inclination against
// the correct reference plane) from a position+velocity+mu state. Not
// implemented yet — scaffolding only.
import type { Vector3 } from './vector3';

export interface OrbitalElements {
  readonly periapsis: number;
  readonly apoapsis: number;
  readonly inclination: number;
}

export function orbitalElementsFromState(
  _position: Vector3,
  _velocity: Vector3,
  _mu: number,
): OrbitalElements {
  throw new Error('not implemented');
}

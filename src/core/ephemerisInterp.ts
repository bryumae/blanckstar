// TODO(mvp0_spec.md §4.5): cubic Hermite interpolation over position+velocity
// ephemeris samples (1 day for planets, 1 hour for the Moon). Linear is
// acceptable only as a bring-up stub. Not implemented yet — scaffolding only.
import type { Vector3 } from './vector3';

export interface EphemerisSample {
  readonly t: number;
  readonly position: Vector3;
  readonly velocity: Vector3;
}

export function interpolateEphemeris(_samples: readonly EphemerisSample[], _t: number): EphemerisSample {
  throw new Error('not implemented');
}

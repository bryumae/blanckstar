// Shared scheduled-burn helpers for trajectory predictors (mvp0_spec.md §5.3,
// §7.7, §8.2): re-point to `direction` at `startTime`, thrust at `throttle`
// for `duration` seconds. At most one burn is active at once (windows must
// not overlap); the first covering burn wins. Lifted to core so the sandbox
// predict() and the UI predictor tab share one implementation and one type
// instead of parallel `PredictBurn`/`PredictorBurn` copies (see issue #17).
import type { Vector3 } from './vector3';
import { normalize, mul } from './vector3';

export interface Burn {
  readonly startTime: number; // unix seconds
  readonly direction: Vector3;
  readonly throttle: number; // [0, 1]
  readonly duration: number; // seconds
}

// Thrust acceleration vector for a burn active at time t, or zero.
export function thrustAt(burns: readonly Burn[], t: number, maxAccel: number): Vector3 {
  for (const b of burns) {
    if (t >= b.startTime && t < b.startTime + b.duration) {
      return mul(normalize(b.direction), b.throttle * maxAccel);
    }
  }
  return { x: 0, y: 0, z: 0 };
}

// All burn start/end times, so steps snap onto burn boundaries exactly the
// way the sim does (§4.4).
export function burnBoundaries(burns: readonly Burn[]): number[] {
  const out: number[] = [];
  for (const b of burns) {
    out.push(b.startTime, b.startTime + b.duration);
  }
  return out;
}

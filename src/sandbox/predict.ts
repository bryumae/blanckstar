// In-worker trajectory prediction (mvp0_spec.md §7.7, §8.2 predict()). Runs the
// EXACT same engine as the live sim (src/core rk4 + gravity + tiered timestep +
// Hermite ephemeris, and src/sim/physics for the acceleration wiring) against a
// PLAYER-ENTERED state — never the hidden ship truth. Output is a table of
// samples; no map, no plots (§7.7 tables only).
//
// This lives in the sandbox worker so `predict()` needs no sim round-trip: the
// bridge hands the worker the ephemeris at run start, and the same code path the
// simulation uses (advance/selectTimestep/stepToBoundary) propagates here. That
// is the "same engine guarantee" from §7.7/§8.2 — shared src/core, not a copy.
import type { Vector3 } from '../core/vector3';
import { normalize, mul } from '../core/vector3';
import type { State } from '../core/rk4';
import type { EphemerisData } from '../core/ephemerisTypes';
import { selectTimestep, stepToBoundary } from '../core/timestep';
import { MAX_ACCELERATION } from '../core/constants';
import { gravitatingBodiesAt, advance } from '../sim/physics';

// A burn in a predict() plan: re-point to `direction` at `startTime`, thrust at
// `throttle` for `duration` seconds. Mirrors the sim's scheduled-burn semantics
// (§5.3) but is applied to the entered state, not the ship.
export interface PredictBurn {
  readonly startTime: number; // unix seconds
  readonly direction: Vector3;
  readonly throttle: number;
  readonly duration: number; // seconds
}

// One row of the predicted trajectory table (§7.7).
export interface PredictSample {
  readonly t: number; // unix seconds
  readonly position: Vector3; // heliocentric ecliptic, m
  readonly velocity: Vector3; // m/s
}

export interface PredictInput {
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly epoch: number; // unix seconds; start time of the propagation
}

// Thrust acceleration vector for a burn active at time t, or zero. At most one
// burn is active at once (windows must not overlap, matching the sim's
// BurnManager contract); the first covering burn wins.
function thrustAt(burns: readonly PredictBurn[], t: number, maxAccel: number): Vector3 {
  for (const b of burns) {
    if (t >= b.startTime && t < b.startTime + b.duration) {
      return mul(normalize(b.direction), b.throttle * maxAccel);
    }
  }
  return { x: 0, y: 0, z: 0 };
}

// All burn start/end times strictly after `now`, so steps snap onto burn
// boundaries exactly the way the sim does (§4.4).
function burnBoundaries(burns: readonly PredictBurn[]): number[] {
  const out: number[] = [];
  for (const b of burns) {
    out.push(b.startTime, b.startTime + b.duration);
  }
  return out;
}

// Propagate `state` from `epoch` for `duration` seconds, emitting a sample every
// `stepOut` seconds (plus the final time). `maxAcceleration` defaults to the
// engine default; callers may pass a per-scenario override for parity with the
// sim. Deterministic — identical inputs yield bit-identical rows.
export function predict(
  ephemeris: EphemerisData,
  input: PredictInput,
  burns: readonly PredictBurn[],
  duration: number,
  stepOut: number,
  maxAcceleration: number = MAX_ACCELERATION,
): PredictSample[] {
  if (!(duration > 0)) {
    return [{ t: input.epoch, position: input.position, velocity: input.velocity }];
  }
  if (!(stepOut > 0)) {
    throw new Error('predict: stepOut must be positive');
  }

  const target = input.epoch + duration;
  const boundaries = burnBoundaries(burns);
  let state: State = { position: input.position, velocity: input.velocity };
  let t = input.epoch;

  const samples: PredictSample[] = [{ t, position: state.position, velocity: state.velocity }];
  let nextOut = input.epoch + stepOut;

  // Guard against pathological non-advancing loops (e.g. a zero-length step from
  // a coincident boundary); cap total substeps generously relative to the span.
  let guard = 0;
  const maxSteps = Math.ceil(duration / 1) + boundaries.length + 100_000;

  while (t < target && guard++ < maxSteps) {
    const bodies = gravitatingBodiesAt(ephemeris, t);
    let dt = selectTimestep(state.position, bodies);
    // Snap only to burn boundaries and the target — exactly the boundaries the
    // sim uses (§4.4). The output cadence is a sampling concern and must NOT be
    // an integration boundary: feeding `nextOut` here would shorten substeps
    // onto the sampling grid and produce a different trajectory than the sim
    // (and than the same predict() with a different stepOut), breaking the
    // same-engine guarantee (§7.7/§8.2).
    dt = stepToBoundary(t, dt, [...boundaries, target]);
    if (dt <= 0) {
      // A boundary sits exactly at t; nudge past it using the base dt so we make
      // progress (matches the sim treating at-`now` boundaries as already hit).
      dt = Math.min(selectTimestep(state.position, bodies), target - t);
      if (dt <= 0) break;
    }

    const thrust = thrustAt(burns, t, maxAcceleration);
    state = advance(ephemeris, state, t, dt, thrust);
    t += dt;

    // Emit a row at the first step endpoint at/after each output tick. Sample
    // times are therefore step-aligned (>= the tick), while the state values
    // remain bit-identical to the sim's own propagation.
    if (t >= nextOut - 1e-9) {
      samples.push({ t, position: state.position, velocity: state.velocity });
      do {
        nextOut += stepOut;
      } while (nextOut <= t + 1e-9);
    }
  }

  // Ensure the final time is represented if the last emitted sample fell short.
  const last = samples[samples.length - 1]!;
  if (last.t < target - 1e-6) {
    samples.push({ t, position: state.position, velocity: state.velocity });
  }
  return samples;
}

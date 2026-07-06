// In-worker trajectory prediction (mvp0_spec.md §7.7, §8.2 predict()). Runs the
// EXACT same engine as the live sim (src/core rk4 + gravity + tiered timestep +
// Hermite ephemeris + acceleration wiring) against a PLAYER-ENTERED state —
// never the hidden ship truth. Output is a table of samples; no map, no plots
// (§7.7 tables only).
//
// This lives in the sandbox worker so `predict()` needs no sim round-trip: the
// bridge hands the worker the ephemeris at run start, and the same code path the
// simulation uses (advance/selectTimestep/stepToBoundary) propagates here. That
// is the "same engine guarantee" from §7.7/§8.2 — shared src/core, not a copy.
import type { Vector3 } from '../core/vector3';
import type { State } from '../core/rk4';
import type { EphemerisData } from '../core/ephemerisTypes';
import { selectTimestep, stepToBoundary } from '../core/timestep';
import { MAX_ACCELERATION } from '../core/constants';
import { gravitatingBodiesAt, advance } from '../core/advance';
import type { Burn } from '../core/burn';
import { thrustAt, burnBoundaries } from '../core/burn';

// A burn in a predict() plan: mirrors the sim's scheduled-burn semantics
// (§5.3) but is applied to the entered state, not the ship.
export type PredictBurn = Burn;

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
      // Advance to the first output tick strictly after t, in O(1). A do/while
      // += stepOut would spin (or stall entirely when stepOut < ULP(t) at large
      // epochs) for a step that spanned many ticks; `max(1, …)` guarantees
      // forward progress even when t sits within epsilon of nextOut.
      nextOut += Math.max(1, Math.floor((t - nextOut) / stepOut) + 1) * stepOut;
    }
  }

  // Ensure the final time is represented if the last emitted sample fell short.
  const last = samples[samples.length - 1]!;
  if (last.t < target - 1e-6) {
    samples.push({ t, position: state.position, velocity: state.velocity });
  }
  return samples;
}

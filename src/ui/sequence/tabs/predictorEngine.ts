// Trajectory predictor propagation (mvp0_spec.md §7.7, §8.2 predict()). Same
// engine as the live simulation — RK4 + Sun/Earth/Moon gravity + tiered
// timestep + Hermite ephemeris — applied to a PLAYER-ENTERED state, never the
// hidden ship truth. Per the phase-8 task boundary this module reimplements
// the small accel-composition closure locally from src/core pieces (mirroring
// src/sim/physics.ts's gravity + throttle*maxAccel*direction during burn
// windows) instead of importing src/sim, so this tab stays inside its
// boundary (src/ui/sequence/tabs/ + tests only).
import type { Vector3 } from '../../../core/vector3';
import { normalize, mul, sub, norm } from '../../../core/vector3';
import type { State, Acceleration } from '../../../core/rk4';
import { rk4Step } from '../../../core/rk4';
import type { EphemerisData } from '../../../core/ephemerisTypes';
import { positionAt, velocityAt } from '../../../core/ephemerisInterp';
import { gravityAcceleration } from '../../../core/gravity';
import type { GravitatingBodies } from '../../../core/gravity';
import { selectTimestep, stepToBoundary } from '../../../core/timestep';
import { MAX_ACCELERATION } from '../../../core/constants';

export interface PredictorBurn {
  readonly startTime: number; // unix seconds
  readonly direction: Vector3;
  readonly throttle: number; // [0, 1]
  readonly duration: number; // seconds
}

export interface PredictorInput {
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly epoch: number; // unix seconds, start time of the propagation
}

export interface PredictorSample {
  readonly t: number; // unix seconds
  readonly position: Vector3; // heliocentric ecliptic, m
  readonly velocity: Vector3; // m/s
  readonly distanceEarth: number; // m
  readonly distanceMoon: number; // m
  readonly distanceMars: number; // m
  readonly earthRelativeSpeed: number; // m/s
}

export interface ClosestApproach {
  readonly t: number;
  readonly distanceEarth: number;
}

export interface PredictorResult {
  readonly samples: readonly PredictorSample[];
  readonly closestApproach: ClosestApproach;
}

function gravitatingBodiesAt(ephemeris: EphemerisData, t: number): GravitatingBodies {
  return {
    sun: positionAt(ephemeris, 'sun', t),
    earth: positionAt(ephemeris, 'earth', t),
    moon: positionAt(ephemeris, 'moon', t),
  };
}

function makeAcceleration(ephemeris: EphemerisData, thrust: Vector3): Acceleration {
  return (state: State, t: number): Vector3 => {
    const g = gravityAcceleration(state.position, gravitatingBodiesAt(ephemeris, t));
    return { x: g.x + thrust.x, y: g.y + thrust.y, z: g.z + thrust.z };
  };
}

function advance(ephemeris: EphemerisData, state: State, t: number, dt: number, thrust: Vector3): State {
  return rk4Step(state, t, dt, makeAcceleration(ephemeris, thrust));
}

// Thrust acceleration vector for a burn active at time t, or zero. At most one
// burn is active at once; the first covering burn wins (mirrors the sim's
// scheduled-burn contract that windows do not overlap).
function thrustAt(burns: readonly PredictorBurn[], t: number, maxAccel: number): Vector3 {
  for (const b of burns) {
    if (t >= b.startTime && t < b.startTime + b.duration) {
      return mul(normalize(b.direction), b.throttle * maxAccel);
    }
  }
  return { x: 0, y: 0, z: 0 };
}

function burnBoundaries(burns: readonly PredictorBurn[]): number[] {
  const out: number[] = [];
  for (const b of burns) {
    out.push(b.startTime, b.startTime + b.duration);
  }
  return out;
}

function sampleAt(ephemeris: EphemerisData, state: State, t: number): PredictorSample {
  const earth = positionAt(ephemeris, 'earth', t);
  const moon = positionAt(ephemeris, 'moon', t);
  const mars = positionAt(ephemeris, 'mars', t);
  return {
    t,
    position: state.position,
    velocity: state.velocity,
    distanceEarth: norm(sub(state.position, earth)),
    distanceMoon: norm(sub(state.position, moon)),
    distanceMars: norm(sub(state.position, mars)),
    earthRelativeSpeed: norm(sub(state.velocity, velocityDelta(ephemeris, t))),
  };
}

// Earth's velocity at t (for Earth-relative speed).
function velocityDelta(ephemeris: EphemerisData, t: number): Vector3 {
  return velocityAt(ephemeris, 'earth', t);
}

// Propagate `input` for `durationSeconds`, emitting a sample every
// `stepOutSeconds` (plus the first and final times), applying `burns` along
// the way. Deterministic: identical inputs yield bit-identical rows, matching
// the same dt policy (selectTimestep + stepToBoundary) as the live sim.
export function propagateForPrediction(
  ephemeris: EphemerisData,
  input: PredictorInput,
  burns: readonly PredictorBurn[],
  durationSeconds: number,
  stepOutSeconds: number,
  maxAcceleration: number = MAX_ACCELERATION,
  onProgress?: (fractionDone: number) => void,
): PredictorResult {
  if (!(durationSeconds > 0)) {
    const sample = sampleAt(ephemeris, { position: input.position, velocity: input.velocity }, input.epoch);
    return { samples: [sample], closestApproach: { t: sample.t, distanceEarth: sample.distanceEarth } };
  }
  if (!(stepOutSeconds > 0)) {
    throw new Error('predictorEngine: stepOutSeconds must be positive');
  }

  const target = input.epoch + durationSeconds;
  const boundaries = burnBoundaries(burns);
  let state: State = { position: input.position, velocity: input.velocity };
  let t = input.epoch;

  const first = sampleAt(ephemeris, state, t);
  const samples: PredictorSample[] = [first];
  let closest: ClosestApproach = { t: first.t, distanceEarth: first.distanceEarth };
  let nextOut = input.epoch + stepOutSeconds;

  let guard = 0;
  const maxSteps = Math.ceil(durationSeconds / 1) + boundaries.length + 100_000;

  while (t < target && guard++ < maxSteps) {
    const bodies = gravitatingBodiesAt(ephemeris, t);
    let dt = selectTimestep(state.position, bodies);
    // Snap only to burn boundaries and the target, matching the sim's grid
    // (§4.4). The output cadence must not be an integration boundary or the
    // trajectory would depend on stepOutSeconds (see the sandbox predict()).
    dt = stepToBoundary(t, dt, [...boundaries, target]);
    if (dt <= 0) {
      dt = Math.min(selectTimestep(state.position, bodies), target - t);
      if (dt <= 0) break;
    }

    const thrust = thrustAt(burns, t, maxAcceleration);
    state = advance(ephemeris, state, t, dt, thrust);
    t += dt;

    // Track closest approach every substep, not only at output ticks, so a
    // close pass between two output rows is not missed.
    const dEarth = norm(sub(state.position, positionAt(ephemeris, 'earth', t)));
    if (dEarth < closest.distanceEarth) {
      closest = { t, distanceEarth: dEarth };
    }

    if (t >= nextOut - 1e-9) {
      samples.push(sampleAt(ephemeris, state, t));
      do {
        nextOut += stepOutSeconds;
      } while (nextOut <= t + 1e-9);
      onProgress?.(Math.min(1, (t - input.epoch) / durationSeconds));
    }
  }

  const last = samples[samples.length - 1]!;
  if (last.t < target - 1e-6) {
    samples.push(sampleAt(ephemeris, state, t));
  }
  onProgress?.(1);

  return { samples, closestApproach: closest };
}

// Split a full propagation into async chunks so a long run does not freeze the
// UI thread. It yields to the event loop roughly every `chunkSeconds` of
// simulated time and reports progress. Returns the SAME PredictorResult as a
// single call to propagateForPrediction with the same inputs: the integration
// grid is identical (burn boundaries + target only — the chunk cadence is a
// yield point, never an integration boundary), so chunking changes only when
// control yields, not the physics.
export async function propagateForPredictionChunked(
  ephemeris: EphemerisData,
  input: PredictorInput,
  burns: readonly PredictorBurn[],
  durationSeconds: number,
  stepOutSeconds: number,
  options: {
    readonly maxAcceleration?: number;
    readonly chunkSeconds?: number; // sim-seconds per chunk; default 1 day
    readonly onProgress?: (fractionDone: number) => void;
    readonly isCancelled?: () => boolean;
    readonly yieldToEventLoop?: () => Promise<void>;
  } = {},
): Promise<PredictorResult | null> {
  const maxAcceleration = options.maxAcceleration ?? MAX_ACCELERATION;
  const chunkSeconds = options.chunkSeconds ?? 86_400;
  const yieldFn = options.yieldToEventLoop ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  if (!(durationSeconds > 0)) {
    return propagateForPrediction(ephemeris, input, burns, durationSeconds, stepOutSeconds, maxAcceleration);
  }

  let state: State = { position: input.position, velocity: input.velocity };
  let t = input.epoch;
  const target = input.epoch + durationSeconds;
  const boundaries = burnBoundaries(burns);

  const first = sampleAt(ephemeris, state, t);
  const samples: PredictorSample[] = [first];
  let closest: ClosestApproach = { t: first.t, distanceEarth: first.distanceEarth };
  let nextOut = input.epoch + stepOutSeconds;
  let guard = 0;
  const maxSteps = Math.ceil(durationSeconds / 1) + boundaries.length + 100_000;

  // The next sim time at which to yield control. Advanced by chunkSeconds; it is
  // deliberately NOT passed to stepToBoundary, so the integration grid matches
  // the single-call path exactly (steps may overshoot a yield point).
  let nextYield = input.epoch + chunkSeconds;

  while (t < target && guard++ < maxSteps) {
    const bodies = gravitatingBodiesAt(ephemeris, t);
    let dt = selectTimestep(state.position, bodies);
    dt = stepToBoundary(t, dt, [...boundaries, target]);
    if (dt <= 0) {
      dt = Math.min(selectTimestep(state.position, bodies), target - t);
      if (dt <= 0) break;
    }

    const thrust = thrustAt(burns, t, maxAcceleration);
    state = advance(ephemeris, state, t, dt, thrust);
    t += dt;

    const dEarth = norm(sub(state.position, positionAt(ephemeris, 'earth', t)));
    if (dEarth < closest.distanceEarth) {
      closest = { t, distanceEarth: dEarth };
    }

    if (t >= nextOut - 1e-9) {
      samples.push(sampleAt(ephemeris, state, t));
      do {
        nextOut += stepOutSeconds;
      } while (nextOut <= t + 1e-9);
    }

    // Yield ~every chunkSeconds of sim time, without perturbing the grid above.
    if (t >= nextYield && t < target) {
      options.onProgress?.(Math.min(1, (t - input.epoch) / durationSeconds));
      if (options.isCancelled?.()) {
        return null;
      }
      await yieldFn();
      if (options.isCancelled?.()) {
        return null;
      }
      do {
        nextYield += chunkSeconds;
      } while (nextYield <= t);
    }
  }

  const last = samples[samples.length - 1]!;
  if (last.t < target - 1e-6) {
    samples.push(sampleAt(ephemeris, state, t));
  }
  options.onProgress?.(1);

  return { samples, closestApproach: closest };
}

// Inserted-state analysis (mvp0_spec.md §7 "inserted state" paragraphs, §7.7,
// §12 AC8). Takes a player-entered/candidate position+velocity+epoch and, USING
// ONLY THAT STATE, propagates it with the same core RK4 + gravity + ephemeris
// engine as the live sim to find closest approach to Earth over a horizon, and
// derives classical orbital elements relative to the Sun or Earth. Never reads
// or touches the true ship state — this module has no access to it at all.
//
// Closest-approach implementation choice: run the *exact* tiered-timestep
// integrator (selectTimestep/gravity, same as the live sim) but chunked across
// animation-frame-sized slices (via a caller-supplied scheduler) so a 90-day
// horizon at dt=60s (~130k steps) never blocks the UI thread in one tick. This
// keeps the predictor "exact" per §7.7 rather than trading accuracy for speed.
import type { Vector3 } from '../../core/vector3';
import { sub, norm } from '../../core/vector3';
import { rk4Step, type State } from '../../core/rk4';
import { gravityAcceleration, type GravitatingBodies } from '../../core/gravity';
import { selectTimestep } from '../../core/timestep';
import type { EphemerisData } from '../../core/ephemerisTypes';
import { positionAt, velocityAt } from '../../core/ephemerisInterp';
import { orbitalElementsFromState, type OrbitalElements } from '../../core/orbitalElements';
import { MU_SUN, MU_EARTH } from '../../core/constants';

export interface InsertedState {
  readonly position: Vector3; // m, heliocentric ecliptic J2000
  readonly velocity: Vector3; // m/s
  readonly epoch: number; // unix seconds
}

export interface ClosestApproachResult {
  readonly distanceMeters: number;
  readonly atTime: number; // unix seconds
  readonly reachedHorizon: boolean; // true if the full horizon was propagated without going out of ephemeris coverage
}

function ephemerisCoverage(ephemeris: EphemerisData): { start: number; end: number } {
  const earthBody = ephemeris.bodies.earth;
  return {
    start: earthBody ? earthBody.t0 : -Infinity,
    end: earthBody ? earthBody.t0 + (earthBody.samples.length - 1) * earthBody.dt : Infinity,
  };
}

// RK4's k4 stage samples at t+dt, which can land a hair past the last in-range
// step's own boundary check due to float rounding; clamp so intermediate
// stages never throw for being a few ULPs over the coverage edge.
function bodiesAt(ephemeris: EphemerisData, t: number, coverage: { start: number; end: number }): GravitatingBodies {
  const clamped = clampToCoverage(t, coverage.start, coverage.end);
  return {
    sun: positionAt(ephemeris, 'sun', clamped),
    earth: positionAt(ephemeris, 'earth', clamped),
    moon: positionAt(ephemeris, 'moon', clamped),
  };
}

// Propagate `state` forward by exactly one tiered-timestep RK4 step, returning
// the new state and the dt actually used (mirrors sim/physics.ts's per-step
// selection, duplicated here deliberately: the Data screen may not import from
// src/sim per the phase boundary, and this is a small, pure, testable rule).
function stepOnce(
  state: State,
  t: number,
  ephemeris: EphemerisData,
  maxDt: number,
  coverage: { start: number; end: number },
): { state: State; dt: number } {
  const bodies = bodiesAt(ephemeris, t, coverage);
  const tiered = selectTimestep(state.position, bodies);
  const dt = Math.min(tiered, maxDt);
  const accel = (s: State, at: number): Vector3 => gravityAcceleration(s.position, bodiesAt(ephemeris, at, coverage));
  const next = rk4Step(state, t, dt, accel);
  return { state: next, dt };
}

// Runs the full propagation synchronously, checking Earth distance at every
// step. `maxDt` caps the step size (pass the coarse 60s cruise tier to bound
// worst-case step count; finer tiers still kick in automatically near a body).
export function closestApproachToEarth(
  inserted: InsertedState,
  ephemeris: EphemerisData,
  horizonSeconds: number,
  maxDt = 60,
): ClosestApproachResult {
  const coverage = ephemerisCoverage(ephemeris);

  let state: State = { position: inserted.position, velocity: inserted.velocity };
  let t = inserted.epoch;
  const targetT = inserted.epoch + horizonSeconds;

  let bestDistance = norm(sub(state.position, positionAt(ephemeris, 'earth', clampToCoverage(t, coverage.start, coverage.end))));
  let bestTime = t;

  while (t < targetT) {
    if (t < coverage.start || t > coverage.end) {
      return { distanceMeters: bestDistance, atTime: bestTime, reachedHorizon: false };
    }
    const remaining = targetT - t;
    const { state: next, dt } = stepOnce(state, t, ephemeris, Math.min(maxDt, remaining), coverage);
    const nextT = t + dt;
    const earthPos = positionAt(ephemeris, 'earth', clampToCoverage(nextT, coverage.start, coverage.end));
    const distance = norm(sub(next.position, earthPos));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTime = nextT;
    }
    state = next;
    t = nextT;
  }

  return { distanceMeters: bestDistance, atTime: bestTime, reachedHorizon: true };
}

function clampToCoverage(t: number, start: number, end: number): number {
  return Math.min(Math.max(t, start), end);
}

// ---- Chunked runner (keeps the UI responsive per the CHUNKED requirement) ----
// Runs closestApproachToEarth-equivalent work in slices via a caller-supplied
// scheduler (setTimeout in production, a synchronous "call immediately" stub in
// tests). Each slice runs up to `stepsPerSlice` integrator steps.
export interface ChunkedRunHandle {
  cancel(): void;
}

export function runClosestApproachChunked(
  inserted: InsertedState,
  ephemeris: EphemerisData,
  horizonSeconds: number,
  onDone: (result: ClosestApproachResult) => void,
  onProgress: (fraction: number) => void,
  schedule: (cb: () => void) => void = (cb) => setTimeout(cb, 0),
  stepsPerSlice = 2000,
  maxDt = 60,
): ChunkedRunHandle {
  const coverage = ephemerisCoverage(ephemeris);

  let state: State = { position: inserted.position, velocity: inserted.velocity };
  let t = inserted.epoch;
  const targetT = inserted.epoch + horizonSeconds;
  let bestDistance = norm(sub(state.position, positionAt(ephemeris, 'earth', clampToCoverage(t, coverage.start, coverage.end))));
  let bestTime = t;
  let cancelled = false;

  function finish(reachedHorizon: boolean): void {
    if (cancelled) return;
    onDone({ distanceMeters: bestDistance, atTime: bestTime, reachedHorizon });
  }

  function slice(): void {
    if (cancelled) return;
    let stepsDone = 0;
    while (stepsDone < stepsPerSlice && t < targetT) {
      if (t < coverage.start || t > coverage.end) {
        finish(false);
        return;
      }
      const remaining = targetT - t;
      const { state: next, dt } = stepOnce(state, t, ephemeris, Math.min(maxDt, remaining), coverage);
      const nextT = t + dt;
      const earthPos = positionAt(ephemeris, 'earth', clampToCoverage(nextT, coverage.start, coverage.end));
      const distance = norm(sub(next.position, earthPos));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTime = nextT;
      }
      state = next;
      t = nextT;
      stepsDone += 1;
    }
    onProgress(Math.min(1, (t - inserted.epoch) / horizonSeconds));
    if (t >= targetT) {
      finish(true);
      return;
    }
    schedule(slice);
  }

  schedule(slice);

  return {
    cancel(): void {
      cancelled = true;
    },
  };
}

// ---- Orbital elements (§7 "Inserted-state orbital information") ----

export type OrbitReferenceFrame = 'solar' | 'earth';

export interface InsertedOrbitResult {
  readonly frame: OrbitReferenceFrame;
  readonly elements: OrbitalElements;
}

// Orbital elements from the inserted state, relative to the chosen center.
// Solar: center = Sun (origin), mu = MU_SUN. Earth: center = Earth's ephemeris
// position/velocity at the inserted epoch, mu = MU_EARTH. Inclination is always
// against the frame's ecliptic xy-plane per orbitalElementsFromState (§7).
export function insertedOrbitalElements(
  inserted: InsertedState,
  ephemeris: EphemerisData,
  frame: OrbitReferenceFrame,
): InsertedOrbitResult {
  if (frame === 'solar') {
    const elements = orbitalElementsFromState(inserted.position, inserted.velocity, MU_SUN);
    return { frame, elements };
  }
  const earthPos = positionAt(ephemeris, 'earth', inserted.epoch);
  const earthVel = velocityAt(ephemeris, 'earth', inserted.epoch);
  const elements = orbitalElementsFromState(inserted.position, inserted.velocity, MU_EARTH, earthPos, earthVel);
  return { frame, elements };
}

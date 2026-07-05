// Candidate-search residual math (mvp0_spec.md §7.6, bryum §13 workflow): given
// a candidate position+velocity+epoch and a set of logged measurements, compute
// how well the candidate matches each measurement. This NEVER decides
// correctness — it only reports mismatch magnitudes for the player to weigh.
//
// Simplification (documented, not hidden): a fully honest comparison would
// propagate the candidate's position+velocity from its own epoch to each
// measurement's time via the real RK4/gravity engine, and light-time-solve
// from THAT position. We do neither — the candidate-search grid must stay
// cheap to evaluate at up to ~20k candidates. Instead every measurement is
// evaluated by treating the candidate's stated position AS IF it were the
// ship's position at the measurement's own time (tSent for radio locks,
// simTime otherwise) — no propagation, no light-time correction on the
// candidate side. If a candidate's epoch is far from a measurement's time,
// this residual is correspondingly less meaningful. The column header
// ("MISMATCH") and UI footnote make clear these are uncorrected residuals,
// never a correctness signal.
import type { Vector3 } from '../../../core/vector3';
import { sub, norm, angleBetween } from '../../../core/vector3';
import type { BodyId, Measurement } from '../../../sim/types';

export interface CandidateSearchInput {
  readonly position: Vector3; // m, heliocentric ecliptic J2000
  readonly velocity: Vector3; // m/s (currently unused by residuals; kept for future range-rate use)
  readonly epoch: number; // unix seconds
}

// Per-measurement residual: for radio locks, both a range and a direction
// residual are reported (two columns); for sunDirection/angularSeparation, a
// single angular residual.
export interface MeasurementResidual {
  readonly measurementId: number;
  readonly kind: Measurement['data']['kind'];
  readonly rangeResidualMeters?: number; // radioLock only
  readonly directionResidualRadians?: number; // radioLock, sunDirection
  readonly angleResidualRadians?: number; // angularSeparation
}

export interface CandidateSearchResult {
  readonly residuals: readonly MeasurementResidual[];
  // RMS of all residual components, normalized so range (meters) and angle
  // (radians) don't dominate each other: range residuals are scaled to km
  // before combining with angle residuals in radians. This is a MISMATCH
  // score, not a probability or confidence value.
  readonly rmsMismatch: number;
}

// Body position at a given time, injected so this module stays pure and does
// not import ephemeris interpolation directly (callers already have an
// EphemerisData handle and positionAt()).
export type BodyPositionAt = (body: BodyId, t: number) => Vector3;

function residualForMeasurement(
  candidate: CandidateSearchInput,
  measurement: Measurement,
  bodyPositionAt: BodyPositionAt,
): MeasurementResidual {
  const data = measurement.data;
  if (data.kind === 'radioLock') {
    // Evaluate the candidate at the measurement's transmit time (documented
    // simplification above — no propagation from the candidate's own epoch).
    const earthAtSent = bodyPositionAt('earth', data.tSent);
    const predictedDelta = sub(earthAtSent, candidate.position);
    const predictedRange = norm(predictedDelta);
    const rangeResidualMeters = Math.abs(predictedRange - data.rangeMeters);
    const directionResidualRadians =
      predictedRange === 0 ? 0 : angleBetween(predictedDelta, data.direction);
    return { measurementId: measurement.id, kind: data.kind, rangeResidualMeters, directionResidualRadians };
  }
  if (data.kind === 'sunDirection') {
    // Evaluated the same way as radioLock: candidate treated as the observer
    // at the time the sunDirection reading was taken (measurement.simTime),
    // no propagation from the candidate's own epoch (same simplification).
    const sunAtT = bodyPositionAt('sun', measurement.simTime);
    const predicted = sub(sunAtT, candidate.position);
    const directionResidualRadians = angleBetween(predicted, data.direction);
    return { measurementId: measurement.id, kind: data.kind, directionResidualRadians };
  }
  if (data.kind === 'angularSeparation') {
    // Predicted angle between bodyA and bodyB AS SEEN FROM THE CANDIDATE
    // position at the measurement's simTime (no light-time correction on the
    // candidate side — same simplification as above), compared to the
    // logged, light-time-corrected angle actually measured from the ship.
    const a = sub(bodyPositionAt(data.bodyA, measurement.simTime), candidate.position);
    const b = sub(bodyPositionAt(data.bodyB, measurement.simTime), candidate.position);
    const predictedAngle = angleBetween(a, b);
    const angleResidualRadians = Math.abs(predictedAngle - data.radians);
    return { measurementId: measurement.id, kind: data.kind, angleResidualRadians };
  }
  // starAttitude carries no positional information usable for a state residual.
  return { measurementId: measurement.id, kind: data.kind };
}

const KM = 1000;

export function evaluateCandidateAgainstMeasurements(
  candidate: CandidateSearchInput,
  measurements: readonly Measurement[],
  bodyPositionAt: BodyPositionAt,
): CandidateSearchResult {
  const residuals = measurements.map((m) => residualForMeasurement(candidate, m, bodyPositionAt));

  const components: number[] = [];
  for (const r of residuals) {
    if (r.rangeResidualMeters !== undefined) components.push(r.rangeResidualMeters / KM);
    if (r.directionResidualRadians !== undefined) components.push(r.directionResidualRadians);
    if (r.angleResidualRadians !== undefined) components.push(r.angleResidualRadians);
  }
  const rmsMismatch =
    components.length === 0 ? 0 : Math.sqrt(components.reduce((sum, c) => sum + c * c, 0) / components.length);

  return { residuals, rmsMismatch };
}

// ---- coordinate/velocity grid generation, bounded evaluation count ----

export interface Range3 {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly zMin: number;
  readonly zMax: number;
}

// Number of grid points along one axis for a given range and step (inclusive
// of both ends when the span divides evenly; otherwise rounds up so the max
// bound is still covered).
function axisCount(min: number, max: number, step: number): number {
  if (step <= 0) throw new Error('candidateSearch: step must be positive');
  if (max < min) throw new Error('candidateSearch: range max must be >= min');
  if (max === min) return 1;
  return Math.floor((max - min) / step) + 1;
}

export function positionGridCount(range: Range3, step: number): number {
  return (
    axisCount(range.xMin, range.xMax, step) *
    axisCount(range.yMin, range.yMax, step) *
    axisCount(range.zMin, range.zMax, step)
  );
}

export const MAX_CANDIDATE_EVALUATIONS = 20_000;

// Generate the position grid (one candidate per grid point), bounded to
// MAX_CANDIDATE_EVALUATIONS. Callers must check positionGridCount(...) first
// and refuse to run (or shrink the grid) if it exceeds the cap — this function
// throws defensively if asked to exceed it, so a caller cannot bypass the cap.
export function* generatePositionGrid(range: Range3, step: number): Generator<Vector3> {
  const count = positionGridCount(range, step);
  if (count > MAX_CANDIDATE_EVALUATIONS) {
    throw new Error(
      `candidateSearch: grid of ${count} candidates exceeds the ${MAX_CANDIDATE_EVALUATIONS} evaluation cap`,
    );
  }
  const nx = axisCount(range.xMin, range.xMax, step);
  const ny = axisCount(range.yMin, range.yMax, step);
  const nz = axisCount(range.zMin, range.zMax, step);
  for (let i = 0; i < nx; i++) {
    const x = i === nx - 1 ? range.xMax : range.xMin + i * step;
    for (let j = 0; j < ny; j++) {
      const y = j === ny - 1 ? range.yMax : range.yMin + j * step;
      for (let k = 0; k < nz; k++) {
        const z = k === nz - 1 ? range.zMax : range.zMin + k * step;
        yield { x, y, z };
      }
    }
  }
}

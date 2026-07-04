// Candidate-search residual math (src/ui/sequence/tabs/candidateSearch.ts,
// mvp0_spec.md §7.6, bryum §13). Hand-computed cases per the phase-8 brief.
import { describe, it, expect } from 'vitest';
import {
  evaluateCandidateAgainstMeasurements,
  positionGridCount,
  generatePositionGrid,
  MAX_CANDIDATE_EVALUATIONS,
  type CandidateSearchInput,
  type BodyPositionAt,
} from '../../src/ui/sequence/tabs/candidateSearch';
import type { Measurement } from '../../src/sim/types';

const EARTH_AT_T: Record<number, { x: number; y: number; z: number }> = {
  100: { x: 1_000_000, y: 0, z: 0 },
};
const SUN_AT_T: Record<number, { x: number; y: number; z: number }> = {
  100: { x: 0, y: 0, z: 0 },
};

const bodyPositionAt: BodyPositionAt = (body, t) => {
  if (body === 'earth') return EARTH_AT_T[t]!;
  if (body === 'sun') return SUN_AT_T[t]!;
  if (body === 'mars') return { x: 5_000_000, y: 0, z: 0 };
  return { x: 0, y: 0, z: 0 };
};

describe('evaluateCandidateAgainstMeasurements — radioLock', () => {
  it('zero residual when the candidate sits exactly on the measured range+direction', () => {
    // Candidate at origin; Earth at (1e6, 0, 0) at tSent=100 -> predicted range
    // 1e6 m along +x, matching a measurement that says exactly that.
    const candidate: CandidateSearchInput = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, epoch: 100 };
    const measurements: Measurement[] = [
      {
        id: 1,
        simTime: 100,
        data: {
          kind: 'radioLock',
          body: 'earth',
          rangeMeters: 1_000_000,
          direction: { x: 1, y: 0, z: 0 },
          quality: 1,
          tSent: 100,
          tReceived: 100,
        },
      },
    ];
    const result = evaluateCandidateAgainstMeasurements(candidate, measurements, bodyPositionAt);
    expect(result.residuals).toHaveLength(1);
    expect(result.residuals[0]!.rangeResidualMeters).toBeCloseTo(0, 6);
    expect(result.residuals[0]!.directionResidualRadians).toBeCloseTo(0, 10);
    expect(result.rmsMismatch).toBeCloseTo(0, 6);
  });

  it('reports the hand-computed range and direction mismatch for an offset candidate', () => {
    // Candidate at (0, 500_000, 0): predicted vector to Earth is
    // (1e6, -5e5, 0), predicted range = sqrt(1e6^2 + 5e5^2) = 1_118_033.99 m.
    // Measured range is 1_000_000 m -> range residual ~118_033.99 m.
    const candidate: CandidateSearchInput = {
      position: { x: 0, y: 500_000, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      epoch: 100,
    };
    const measurements: Measurement[] = [
      {
        id: 1,
        simTime: 100,
        data: {
          kind: 'radioLock',
          body: 'earth',
          rangeMeters: 1_000_000,
          direction: { x: 1, y: 0, z: 0 },
          quality: 1,
          tSent: 100,
          tReceived: 100,
        },
      },
    ];
    const result = evaluateCandidateAgainstMeasurements(candidate, measurements, bodyPositionAt);
    const predictedRange = Math.sqrt(1_000_000 ** 2 + 500_000 ** 2);
    expect(result.residuals[0]!.rangeResidualMeters).toBeCloseTo(predictedRange - 1_000_000, 3);
    // Predicted direction (1e6,-5e5,0) normalized vs measured (1,0,0): angle = atan(5e5/1e6).
    const expectedAngle = Math.atan2(500_000, 1_000_000);
    expect(result.residuals[0]!.directionResidualRadians).toBeCloseTo(expectedAngle, 6);
  });
});

describe('evaluateCandidateAgainstMeasurements — sunDirection', () => {
  it('zero residual when candidate direction to Sun matches the measurement', () => {
    // Sun at origin, candidate at (-1e6, 0, 0) -> predicted ship->Sun direction (1,0,0).
    const candidate: CandidateSearchInput = { position: { x: -1_000_000, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, epoch: 100 };
    const measurements: Measurement[] = [
      { id: 2, simTime: 100, data: { kind: 'sunDirection', direction: { x: 1, y: 0, z: 0 } } },
    ];
    const result = evaluateCandidateAgainstMeasurements(candidate, measurements, bodyPositionAt);
    expect(result.residuals[0]!.directionResidualRadians).toBeCloseTo(0, 10);
  });

  it('reports a 90-degree residual for an orthogonal mismatch', () => {
    const candidate: CandidateSearchInput = { position: { x: -1_000_000, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, epoch: 100 };
    const measurements: Measurement[] = [
      { id: 2, simTime: 100, data: { kind: 'sunDirection', direction: { x: 0, y: 1, z: 0 } } },
    ];
    const result = evaluateCandidateAgainstMeasurements(candidate, measurements, bodyPositionAt);
    expect(result.residuals[0]!.directionResidualRadians).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe('evaluateCandidateAgainstMeasurements — angularSeparation', () => {
  it('zero residual when the candidate reproduces the measured separation', () => {
    // From origin: Earth at (1e6,0,0), Mars at (5e6,0,0) -> collinear, angle 0.
    const candidate: CandidateSearchInput = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, epoch: 100 };
    const measurements: Measurement[] = [
      { id: 3, simTime: 100, data: { kind: 'angularSeparation', bodyA: 'earth', bodyB: 'mars', radians: 0 } },
    ];
    const result = evaluateCandidateAgainstMeasurements(candidate, measurements, bodyPositionAt);
    expect(result.residuals[0]!.angleResidualRadians).toBeCloseTo(0, 10);
  });

  it('reports the mismatch between predicted and measured separation', () => {
    const candidate: CandidateSearchInput = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, epoch: 100 };
    const measurements: Measurement[] = [
      { id: 3, simTime: 100, data: { kind: 'angularSeparation', bodyA: 'earth', bodyB: 'mars', radians: 0.5 } },
    ];
    const result = evaluateCandidateAgainstMeasurements(candidate, measurements, bodyPositionAt);
    expect(result.residuals[0]!.angleResidualRadians).toBeCloseTo(0.5, 10);
  });
});

describe('evaluateCandidateAgainstMeasurements — starAttitude passthrough', () => {
  it('produces a residual entry with no numeric fields', () => {
    const candidate: CandidateSearchInput = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, epoch: 100 };
    const measurements: Measurement[] = [{ id: 4, simTime: 100, data: { kind: 'starAttitude', forward: { x: 1, y: 0, z: 0 } } }];
    const result = evaluateCandidateAgainstMeasurements(candidate, measurements, bodyPositionAt);
    expect(result.residuals[0]).toEqual({ measurementId: 4, kind: 'starAttitude' });
    expect(result.rmsMismatch).toBe(0);
  });
});

describe('grid generation', () => {
  it('positionGridCount matches axis counts', () => {
    const range = { xMin: 0, xMax: 10, yMin: 0, yMax: 10, zMin: 0, zMax: 0 };
    // step 5 -> 3 points per axis on x/y (0,5,10), 1 point on z (min==max).
    expect(positionGridCount(range, 5)).toBe(3 * 3 * 1);
  });

  it('generatePositionGrid yields exactly positionGridCount points, hitting both bounds', () => {
    const range = { xMin: 0, xMax: 10, yMin: 0, yMax: 4, zMin: 1, zMax: 1 };
    const points = [...generatePositionGrid(range, 3)];
    expect(points.length).toBe(positionGridCount(range, 3));
    expect(points.some((p) => p.x === 0)).toBe(true);
    expect(points.some((p) => p.x === 10)).toBe(true);
    expect(points.every((p) => p.z === 1)).toBe(true);
  });

  it('throws if the grid would exceed the evaluation cap', () => {
    const range = { xMin: 0, xMax: 1000, yMin: 0, yMax: 1000, zMin: 0, zMax: 1000 };
    expect(() => positionGridCount(range, 1)).not.toThrow(); // count is cheap, no cap here
    expect(positionGridCount(range, 1)).toBeGreaterThan(MAX_CANDIDATE_EVALUATIONS);
    expect(() => [...generatePositionGrid(range, 1)]).toThrow();
  });

  it('rejects non-positive step and inverted ranges', () => {
    const range = { xMin: 0, xMax: 10, yMin: 0, yMax: 10, zMin: 0, zMax: 10 };
    expect(() => positionGridCount(range, 0)).toThrow();
    expect(() => positionGridCount({ ...range, xMax: -1 }, 1)).toThrow();
  });
});

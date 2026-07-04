// In-worker predict() (src/sandbox/predict.ts, mvp0_spec.md §7.7, §8.2). The
// contract: predict() uses the EXACT same engine as the sim, so its rows must
// match a direct src/sim/physics propagation of the same entered state.
import { describe, it, expect } from 'vitest';
import { predict } from '../../src/sandbox/predict';
import { advance, gravitatingBodiesAt } from '../../src/sim/physics';
import { selectTimestep, stepToBoundary } from '../../src/core/timestep';
import { normalize, mul } from '../../src/core/vector3';
import type { State } from '../../src/core/rk4';
import { loadRealEphemeris, coverageEpoch, bodyPos } from './simHelpers';
import { velocityAt } from '../../src/core/ephemerisInterp';

// Reference propagation mirroring predict()'s stepping, but written out here so a
// divergence in predict.ts would show as a mismatch.
function referencePropagate(
  eph: ReturnType<typeof loadRealEphemeris>,
  start: State,
  epoch: number,
  duration: number,
  stepOut: number,
  burns: { startTime: number; direction: { x: number; y: number; z: number }; throttle: number; duration: number }[] = [],
): { t: number; position: { x: number; y: number; z: number } }[] {
  const target = epoch + duration;
  const boundaries: number[] = [];
  for (const b of burns) boundaries.push(b.startTime, b.startTime + b.duration);
  let state = start;
  let t = epoch;
  const out = [{ t, position: state.position }];
  let nextOut = epoch + stepOut;
  const thrustAt = (time: number) => {
    for (const b of burns) {
      if (time >= b.startTime && time < b.startTime + b.duration) {
        return mul(normalize(b.direction), b.throttle * 0.5);
      }
    }
    return { x: 0, y: 0, z: 0 };
  };
  let guard = 0;
  while (t < target && guard++ < 1e7) {
    const bodies = gravitatingBodiesAt(eph, t);
    let dt = selectTimestep(state.position, bodies);
    dt = stepToBoundary(t, dt, [...boundaries, nextOut, target]);
    if (dt <= 0) {
      dt = Math.min(selectTimestep(state.position, bodies), target - t);
      if (dt <= 0) break;
    }
    state = advance(eph, state, t, dt, thrustAt(t));
    t += dt;
    if (t >= nextOut - 1e-9) {
      out.push({ t, position: state.position });
      nextOut += stepOut;
    }
  }
  return out;
}

describe('predict', () => {
  const eph = loadRealEphemeris();
  const epoch = coverageEpoch(eph);
  const earthP = bodyPos(eph, 'earth', epoch);
  const earthV = velocityAt(eph, 'earth', epoch);
  // A cruise state ~0.2 AU off Earth, moving with Earth.
  const input = {
    position: { x: earthP.x + 3e10, y: earthP.y, z: earthP.z },
    velocity: earthV,
    epoch,
  };

  it('matches a direct core propagation (coasting, same engine guarantee)', () => {
    const duration = 6 * 3600;
    const stepOut = 3600;
    const rows = predict(eph, input, [], duration, stepOut);
    const ref = referencePropagate(eph, { position: input.position, velocity: input.velocity }, epoch, duration, stepOut);
    expect(rows.length).toBe(ref.length);
    for (let i = 0; i < rows.length; i += 1) {
      expect(rows[i]!.t).toBeCloseTo(ref[i]!.t, 6);
      expect(rows[i]!.position.x).toBeCloseTo(ref[i]!.position.x, 3);
      expect(rows[i]!.position.y).toBeCloseTo(ref[i]!.position.y, 3);
      expect(rows[i]!.position.z).toBeCloseTo(ref[i]!.position.z, 3);
    }
  });

  it('matches a direct propagation with a burn in the interval', () => {
    const duration = 4 * 3600;
    const stepOut = 1800;
    const burns = [
      { startTime: epoch + 3600, direction: { x: 1, y: 0, z: 0 }, throttle: 0.5, duration: 600 },
    ];
    const rows = predict(eph, input, burns, duration, stepOut);
    const ref = referencePropagate(eph, { position: input.position, velocity: input.velocity }, epoch, duration, stepOut, burns);
    expect(rows.length).toBe(ref.length);
    const last = rows[rows.length - 1]!;
    const refLast = ref[ref.length - 1]!;
    expect(last.position.x).toBeCloseTo(refLast.position.x, 2);
    expect(last.position.y).toBeCloseTo(refLast.position.y, 2);
  });

  it('is deterministic — identical inputs give bit-identical rows', () => {
    const a = predict(eph, input, [], 3 * 3600, 3600);
    const b = predict(eph, input, [], 3 * 3600, 3600);
    expect(a).toEqual(b);
  });

  it('returns a single sample for non-positive duration', () => {
    const rows = predict(eph, input, [], 0, 3600);
    expect(rows).toEqual([{ t: epoch, position: input.position, velocity: input.velocity }]);
  });

  it('throws on non-positive stepOut', () => {
    expect(() => predict(eph, input, [], 3600, 0)).toThrow(/stepOut/);
  });
});

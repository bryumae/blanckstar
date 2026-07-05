import { describe, expect, it } from 'vitest';
import {
  interpolateEphemeris,
  positionAt,
  velocityAt,
  stateAt,
  type EphemerisSample,
} from '../../src/core/ephemerisInterp';
import type { EphemerisData } from '../../src/core/ephemerisTypes';
import { MU_SUN } from '../../src/core/constants';
import { norm, sub } from '../../src/core/vector3';

// A cubic position trajectory with matching analytic velocity per axis.
function cubicSample(t: number): EphemerisSample {
  type Cubic = readonly [number, number, number, number];
  const pos = (c: Cubic) => c[0] + c[1] * t + c[2] * t * t + c[3] * t * t * t;
  const vel = (c: Cubic) => c[1] + 2 * c[2] * t + 3 * c[3] * t * t;
  const cx: Cubic = [1, 2, -0.5, 0.1];
  const cy: Cubic = [-3, 0.7, 0.2, -0.05];
  const cz: Cubic = [0, -1, 0.3, 0.02];
  return {
    t,
    position: { x: pos(cx), y: pos(cy), z: pos(cz) },
    velocity: { x: vel(cx), y: vel(cy), z: vel(cz) },
  };
}

describe('interpolateEphemeris (sample array)', () => {
  it('reproduces a cubic trajectory exactly at interior points', () => {
    const samples: EphemerisSample[] = [0, 10, 20, 30].map(cubicSample);
    for (const tq of [3, 7, 12.5, 25, 29.9]) {
      const got = interpolateEphemeris(samples, tq);
      const truth = cubicSample(tq);
      expect(got.position.x).toBeCloseTo(truth.position.x, 6);
      expect(got.position.y).toBeCloseTo(truth.position.y, 6);
      expect(got.position.z).toBeCloseTo(truth.position.z, 6);
      // Velocity is the analytic Hermite derivative -> matches the cubic's derivative.
      expect(got.velocity.x).toBeCloseTo(truth.velocity.x, 6);
      expect(got.velocity.y).toBeCloseTo(truth.velocity.y, 6);
      expect(got.velocity.z).toBeCloseTo(truth.velocity.z, 6);
    }
  });

  it('returns endpoints exactly', () => {
    const times = [0, 10, 20];
    const samples = times.map(cubicSample);
    const a = interpolateEphemeris(samples, 0);
    expect(a.position).toEqual(cubicSample(0).position);
    const b = interpolateEphemeris(samples, 20);
    expect(b.position.x).toBeCloseTo(cubicSample(20).position.x, 6);
  });

  it('throws on too few samples', () => {
    expect(() => interpolateEphemeris([], 0)).toThrow(/at least two/);
    expect(() => interpolateEphemeris([cubicSample(0)], 0)).toThrow(/at least two/);
  });

  it('throws when t is outside coverage', () => {
    const samples = [0, 10, 20].map(cubicSample);
    expect(() => interpolateEphemeris(samples, -1)).toThrow(/outside sample coverage/);
    expect(() => interpolateEphemeris(samples, 21)).toThrow(/outside sample coverage/);
  });

  it('bounds error against a sampled circular (Kepler) orbit', () => {
    // Sample a circular heliocentric orbit at 1-hour spacing; Hermite between
    // samples should reproduce it to high accuracy.
    const r = 1.5e11;
    const omega = Math.sqrt(MU_SUN / (r * r * r));
    const dt = 3600;
    const sampleAt = (t: number): EphemerisSample => ({
      t,
      position: { x: r * Math.cos(omega * t), y: r * Math.sin(omega * t), z: 0 },
      velocity: { x: -r * omega * Math.sin(omega * t), y: r * omega * Math.cos(omega * t), z: 0 },
    });
    const samples = [0, 1, 2, 3, 4].map((i) => sampleAt(i * dt));
    let maxRelErr = 0;
    for (let k = 1; k < 40; k++) {
      const tq = (k / 40) * (4 * dt);
      const got = interpolateEphemeris(samples, tq);
      const truth = sampleAt(tq);
      const err = norm(sub(got.position, truth.position)) / r;
      maxRelErr = Math.max(maxRelErr, err);
    }
    expect(maxRelErr).toBeLessThan(1e-7);
  });
});

describe('ephemeris JSON-schema helpers', () => {
  const data: EphemerisData = {
    frame: 'heliocentric-ecliptic-J2000',
    units: { position: 'm', velocity: 'm/s', time: 'unix-seconds' },
    bodies: {
      sun: { t0: 1000, dt: 100, samples: [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]] },
      earth: {
        t0: 1000,
        dt: 100,
        // Linear-in-time motion: position = base + v*(t-t0), velocity constant.
        samples: [
          [10, 20, 30, 1, -2, 0.5],
          [110, -180, 80, 1, -2, 0.5],
          [210, -380, 130, 1, -2, 0.5],
        ],
      },
    },
  };

  it('interpolates position and velocity on the uniform grid', () => {
    // Query at t=1150 (midway in segment 1). Linear motion -> exact.
    const p = positionAt(data, 'earth', 1150);
    expect(p.x).toBeCloseTo(10 + 1 * 150, 6);
    expect(p.y).toBeCloseTo(20 - 2 * 150, 6);
    expect(p.z).toBeCloseTo(30 + 0.5 * 150, 6);
    const v = velocityAt(data, 'earth', 1150);
    expect(v.x).toBeCloseTo(1, 6);
    expect(v.y).toBeCloseTo(-2, 6);
    expect(v.z).toBeCloseTo(0.5, 6);
  });

  it('handles the exact last-sample time (clamps to final segment)', () => {
    const p = positionAt(data, 'earth', 1200);
    expect(p.x).toBeCloseTo(210, 6);
    const s = stateAt(data, 'earth', 1200);
    expect(s.t).toBe(1200);
  });

  it('throws for an absent body', () => {
    expect(() => positionAt(data, 'mars', 1000)).toThrow(/no data for body/);
    expect(() => velocityAt(data, 'jupiter', 1000)).toThrow(/no data for body/);
  });

  it('throws when t is out of coverage', () => {
    expect(() => positionAt(data, 'earth', 999)).toThrow(/outside coverage/);
    expect(() => positionAt(data, 'earth', 1201)).toThrow(/outside coverage/);
  });

  it('throws when a body has fewer than two samples', () => {
    const bad: EphemerisData = {
      ...data,
      bodies: { moon: { t0: 0, dt: 10, samples: [[0, 0, 0, 0, 0, 0]] } },
    };
    expect(() => positionAt(bad, 'moon', 0)).toThrow(/at least two samples/);
  });
});

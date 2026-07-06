import { describe, expect, it } from 'vitest';
import { gravitatingBodiesAt, makeAcceleration, advance } from '../../src/core/advance';
import { rk4Step } from '../../src/core/rk4';
import { gravityAcceleration } from '../../src/core/gravity';
import type { EphemerisData, BodyEphemeris, StateSample } from '../../src/core/ephemerisTypes';
import type { State } from '../../src/core/rk4';

function stillBody(position: readonly [number, number, number]): BodyEphemeris {
  const sample: StateSample = [position[0], position[1], position[2], 0, 0, 0];
  return { t0: 0, dt: 100, samples: [sample, sample] };
}

const EPHEMERIS: EphemerisData = {
  frame: 'heliocentric-ecliptic-j2000',
  units: { position: 'm', velocity: 'm/s', time: 's' },
  bodies: {
    sun: stillBody([1e11, 0, 0]),
    earth: stillBody([1.5e11, 0, 0]),
    moon: stillBody([1.5e11 + 3.8e8, 0, 0]),
  },
};

describe('gravitatingBodiesAt', () => {
  it('samples Sun/Earth/Moon positions from the ephemeris at time t', () => {
    const bodies = gravitatingBodiesAt(EPHEMERIS, 50);
    expect(bodies.sun).toEqual({ x: 1e11, y: 0, z: 0 });
    expect(bodies.earth).toEqual({ x: 1.5e11, y: 0, z: 0 });
    expect(bodies.moon).toEqual({ x: 1.5e11 + 3.8e8, y: 0, z: 0 });
  });
});

describe('makeAcceleration', () => {
  it('adds a fixed thrust vector to gravity, evaluated at the given state/time', () => {
    const thrust = { x: 1, y: 2, z: 3 };
    const accel = makeAcceleration(EPHEMERIS, thrust);
    const state: State = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } };
    const a = accel(state, 10);
    const g = gravityAcceleration(state.position, gravitatingBodiesAt(EPHEMERIS, 10));
    expect(a).toEqual({ x: g.x + thrust.x, y: g.y + thrust.y, z: g.z + thrust.z });
  });

  it('returns pure gravity when thrust is zero', () => {
    const accel = makeAcceleration(EPHEMERIS, { x: 0, y: 0, z: 0 });
    const state: State = { position: { x: 1e9, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } };
    const a = accel(state, 0);
    const g = gravityAcceleration(state.position, gravitatingBodiesAt(EPHEMERIS, 0));
    expect(a).toEqual(g);
  });
});

describe('advance', () => {
  it('matches a manual rk4Step using the same acceleration composition', () => {
    const thrust = { x: 0.5, y: -0.25, z: 0 };
    const state: State = { position: { x: 1e9, y: 2e8, z: 0 }, velocity: { x: 10, y: -5, z: 1 } };
    const dt = 60;
    const t = 5;
    const next = advance(EPHEMERIS, state, t, dt, thrust);
    const expected = rk4Step(state, t, dt, makeAcceleration(EPHEMERIS, thrust));
    expect(next).toEqual(expected);
  });

  it('is deterministic: identical inputs produce bit-identical outputs', () => {
    const state: State = { position: { x: 7e8, y: -3e8, z: 1e7 }, velocity: { x: 100, y: 200, z: -10 } };
    const a = advance(EPHEMERIS, state, 0, 30, { x: 1, y: 0, z: 0 });
    const b = advance(EPHEMERIS, state, 0, 30, { x: 1, y: 0, z: 0 });
    expect(a).toEqual(b);
  });
});

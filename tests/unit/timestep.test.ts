import { describe, expect, it } from 'vitest';
import {
  timestepForDistance,
  nearestBodyDistance,
  selectTimestep,
  stepToBoundary,
  DT_CRUISE,
  DT_APPROACH,
  DT_CLOSE,
} from '../../src/core/timestep';

describe('timestepForDistance', () => {
  it('selects the cruise step above 1e9 m', () => {
    expect(timestepForDistance(2e9)).toBe(DT_CRUISE);
    expect(timestepForDistance(1e9 + 1)).toBe(DT_CRUISE);
  });

  it('selects the approach step in [1e7, 1e9]', () => {
    expect(timestepForDistance(1e9)).toBe(DT_APPROACH); // boundary: not > 1e9
    expect(timestepForDistance(5e8)).toBe(DT_APPROACH);
    expect(timestepForDistance(1e7)).toBe(DT_APPROACH); // boundary: not < 1e7
  });

  it('selects the close step below 1e7 m', () => {
    expect(timestepForDistance(1e7 - 1)).toBe(DT_CLOSE);
    expect(timestepForDistance(5e6)).toBe(DT_CLOSE);
  });
});

describe('nearestBodyDistance / selectTimestep', () => {
  const bodies = {
    sun: { x: 0, y: 0, z: 0 },
    earth: { x: 1.5e11, y: 0, z: 0 },
    moon: { x: 1.5e11 + 3.8e8, y: 0, z: 0 },
  };

  it('finds the nearest of Sun/Earth/Moon', () => {
    // Ship 5e6 m from Earth -> nearest is Earth.
    const ship = { x: 1.5e11 - 5e6, y: 0, z: 0 };
    expect(nearestBodyDistance(ship, bodies)).toBeCloseTo(5e6, 0);
    expect(selectTimestep(ship, bodies)).toBe(DT_CLOSE);
  });

  it('uses cruise dt in deep space between Earth and Sun', () => {
    const ship = { x: 0.5e11, y: 0, z: 0 }; // ~5e10 from Sun, ~1e11 from Earth
    expect(selectTimestep(ship, bodies)).toBe(DT_CRUISE);
  });
});

describe('stepToBoundary', () => {
  it('takes the full dt when no boundary is within reach', () => {
    expect(stepToBoundary(100, 60, [500, 1000])).toBe(60);
    expect(stepToBoundary(100, 60, [])).toBe(60);
  });

  it('shortens the step to land exactly on the next boundary', () => {
    // Next boundary at 130, now=100, dt=60 -> step 30.
    expect(stepToBoundary(100, 60, [130, 400])).toBe(30);
  });

  it('ignores boundaries at or before now', () => {
    expect(stepToBoundary(100, 60, [100, 90, 175])).toBe(60);
  });

  it('picks the closest boundary strictly ahead', () => {
    expect(stepToBoundary(0, 100, [80, 50, 200])).toBe(50);
  });
});

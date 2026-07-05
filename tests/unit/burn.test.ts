import { describe, expect, it } from 'vitest';
import { thrustAt, burnBoundaries, type Burn } from '../../src/core/burn';

const MAX_ACCEL = 10;

describe('thrustAt', () => {
  it('returns zero thrust when no burn covers t', () => {
    const burns: Burn[] = [{ startTime: 100, direction: { x: 1, y: 0, z: 0 }, throttle: 1, duration: 10 }];
    expect(thrustAt(burns, 50, MAX_ACCEL)).toEqual({ x: 0, y: 0, z: 0 });
    expect(thrustAt(burns, 110, MAX_ACCEL)).toEqual({ x: 0, y: 0, z: 0 }); // end is exclusive
  });

  it('returns throttle * maxAccel along the normalized direction while active', () => {
    const burns: Burn[] = [{ startTime: 100, direction: { x: 0, y: 2, z: 0 }, throttle: 0.5, duration: 10 }];
    const thrust = thrustAt(burns, 105, MAX_ACCEL);
    expect(thrust.x).toBeCloseTo(0, 12);
    expect(thrust.y).toBeCloseTo(5, 12); // 0.5 * 10, direction normalized to unit y
    expect(thrust.z).toBeCloseTo(0, 12);
  });

  it('the start time is inclusive', () => {
    const burns: Burn[] = [{ startTime: 100, direction: { x: 1, y: 0, z: 0 }, throttle: 1, duration: 10 }];
    expect(thrustAt(burns, 100, MAX_ACCEL)).toEqual({ x: MAX_ACCEL, y: 0, z: 0 });
  });

  it('the first covering burn wins when given overlapping burns', () => {
    const burns: Burn[] = [
      { startTime: 100, direction: { x: 1, y: 0, z: 0 }, throttle: 1, duration: 10 },
      { startTime: 100, direction: { x: 0, y: 1, z: 0 }, throttle: 1, duration: 10 },
    ];
    expect(thrustAt(burns, 105, MAX_ACCEL)).toEqual({ x: MAX_ACCEL, y: 0, z: 0 });
  });
});

describe('burnBoundaries', () => {
  it('returns each burn start and end time', () => {
    const burns: Burn[] = [
      { startTime: 100, direction: { x: 1, y: 0, z: 0 }, throttle: 1, duration: 10 },
      { startTime: 200, direction: { x: 0, y: 1, z: 0 }, throttle: 0.5, duration: 30 },
    ];
    expect(burnBoundaries(burns)).toEqual([100, 110, 200, 230]);
  });

  it('returns an empty array for no burns', () => {
    expect(burnBoundaries([])).toEqual([]);
  });
});

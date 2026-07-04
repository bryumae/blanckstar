import { describe, expect, it } from 'vitest';
import {
  OUTSIDE_FOV_DEG,
  TELESCOPE_MAX_FOV_DEG,
  TELESCOPE_MIN_FOV_DEG,
  clampFov,
  clampPitch,
  yawPitchToLookVector,
} from '../../../src/render/scene';

describe('clampFov', () => {
  it('forces outside mode to the fixed outside FOV regardless of input', () => {
    expect(clampFov(5, 'outside')).toBe(OUTSIDE_FOV_DEG);
    expect(clampFov(90, 'outside')).toBe(OUTSIDE_FOV_DEG);
  });

  it('clamps telescope mode within [min, max]', () => {
    expect(clampFov(0, 'telescope')).toBe(TELESCOPE_MIN_FOV_DEG);
    expect(clampFov(1000, 'telescope')).toBe(TELESCOPE_MAX_FOV_DEG);
    expect(clampFov(10, 'telescope')).toBe(10);
  });
});

describe('clampPitch', () => {
  it('leaves in-range pitch untouched', () => {
    expect(clampPitch(0)).toBe(0);
    expect(clampPitch(1)).toBe(1);
    expect(clampPitch(-1)).toBe(-1);
  });

  it('clamps beyond +/- pi/2', () => {
    const clamped = clampPitch(10);
    expect(clamped).toBeLessThan(Math.PI / 2);
    expect(clampPitch(-10)).toBeGreaterThan(-Math.PI / 2);
  });
});

describe('yawPitchToLookVector', () => {
  it('produces a unit vector', () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [1.2, 0.4],
      [-2, -0.3],
    ]) {
      const v = yawPitchToLookVector(yaw!, pitch!);
      expect(v.length()).toBeCloseTo(1, 9);
    }
  });

  it('points along -Z at yaw=0, pitch=0', () => {
    const v = yawPitchToLookVector(0, 0);
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.y).toBeCloseTo(0, 9);
    expect(v.z).toBeCloseTo(-1, 9);
  });

  it('tilts toward +Y as pitch increases', () => {
    const v = yawPitchToLookVector(0, 0.5);
    expect(v.y).toBeCloseTo(Math.sin(0.5), 9);
  });
});

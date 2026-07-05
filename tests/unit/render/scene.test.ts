import { describe, expect, it } from 'vitest';
import {
  OUTSIDE_FOV_DEG,
  TELESCOPE_MAX_FOV_DEG,
  TELESCOPE_MIN_FOV_DEG,
  clampFov,
  clampPitch,
  createScene,
  yawPitchToLookVector,
} from '../../../src/render/scene';

describe('createScene WebGL resilience', () => {
  it('returns a null renderer (not a throw) when no WebGL context is available', () => {
    // happy-dom has no WebGL, so this exercises the headless/blocked-WebGL path
    // that previously threw and aborted app boot (see main.ts screen mounting).
    const canvas = document.createElement('canvas');
    let scene: ReturnType<typeof createScene> | undefined;
    expect(() => {
      scene = createScene(canvas);
    }).not.toThrow();
    expect(scene!.renderer).toBeNull();
    // Scene graph + camera still exist for identify/measure/picking.
    expect(scene!.camera).toBeTruthy();
    expect(scene!.scene).toBeTruthy();
  });

  it('sets the camera up-vector to +Z to match the Z-up world frame', () => {
    const scene = createScene(document.createElement('canvas'));
    expect(scene.camera.up.x).toBeCloseTo(0, 9);
    expect(scene.camera.up.y).toBeCloseTo(0, 9);
    expect(scene.camera.up.z).toBeCloseTo(1, 9);
  });
});

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

  it('aims into the ecliptic plane (+X, dec 0) at yaw=0, pitch=0', () => {
    // The world is Z-up (pole = +Z); bodies lie near the X/Y plane, so the
    // default aim must have z ~ 0 rather than pointing at the -Z south pole.
    const v = yawPitchToLookVector(0, 0);
    expect(v.x).toBeCloseTo(1, 9);
    expect(v.y).toBeCloseTo(0, 9);
    expect(v.z).toBeCloseTo(0, 9);
  });

  it('tilts toward the +Z pole as pitch increases', () => {
    const v = yawPitchToLookVector(0, 0.5);
    expect(v.z).toBeCloseTo(Math.sin(0.5), 9);
  });

  it('sweeps azimuth in the X/Y (ecliptic) plane as yaw increases', () => {
    const v = yawPitchToLookVector(Math.PI / 2, 0);
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.y).toBeCloseTo(1, 9);
    expect(v.z).toBeCloseTo(0, 9);
  });
});

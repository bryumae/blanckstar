import { describe, expect, it } from 'vitest';
import {
  MAG_BRIGHT,
  MAG_FAINT,
  angularSize,
  magnitudeToAlpha,
  magnitudeToSize,
  phaseAngle,
  phaseFactor,
  raDecToUnit,
  reflectedBrightness,
  sunBrightness,
} from '../../../src/render/astro';
import { norm } from '../../../src/core/vector3';

describe('raDecToUnit', () => {
  it('produces unit vectors', () => {
    for (const [ra, dec] of [
      [0, 0],
      [Math.PI / 2, 0],
      [1.234, 0.5],
      [0, Math.PI / 2],
    ]) {
      expect(norm(raDecToUnit(ra!, dec!))).toBeCloseTo(1, 9);
    }
  });

  it('maps ra=0,dec=0 to +x', () => {
    const v = raDecToUnit(0, 0);
    expect(v.x).toBeCloseTo(1, 9);
    expect(v.y).toBeCloseTo(0, 9);
    expect(v.z).toBeCloseTo(0, 9);
  });

  it('maps dec=+90deg to +z regardless of ra', () => {
    const v = raDecToUnit(2.1, Math.PI / 2);
    expect(v.z).toBeCloseTo(1, 9);
  });
});

describe('magnitudeToSize / magnitudeToAlpha', () => {
  it('is monotonically decreasing in magnitude (brighter = bigger/more opaque)', () => {
    const mags = [MAG_BRIGHT, -1, 0, 1, 2, 3, 4, 5, 6, MAG_FAINT];
    for (let i = 1; i < mags.length; i++) {
      expect(magnitudeToSize(mags[i]!)).toBeLessThanOrEqual(magnitudeToSize(mags[i - 1]!));
      expect(magnitudeToAlpha(mags[i]!)).toBeLessThanOrEqual(magnitudeToAlpha(mags[i - 1]!));
    }
  });

  it('clamps outside the bright/faint range', () => {
    expect(magnitudeToSize(-10)).toBe(magnitudeToSize(MAG_BRIGHT));
    expect(magnitudeToSize(20)).toBe(magnitudeToSize(MAG_FAINT));
    expect(magnitudeToAlpha(-10)).toBe(magnitudeToAlpha(MAG_BRIGHT));
    expect(magnitudeToAlpha(20)).toBe(magnitudeToAlpha(MAG_FAINT));
  });

  it('alpha stays within [0.15, 1.0]', () => {
    for (const mag of [-5, -1.5, 0, 3, 6.5, 10]) {
      const a = magnitudeToAlpha(mag);
      expect(a).toBeGreaterThanOrEqual(0.15);
      expect(a).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('angularSize', () => {
  it('matches 2*atan(R/d)', () => {
    expect(angularSize(1, 1)).toBeCloseTo(2 * Math.atan(1), 12);
    expect(angularSize(6_371_000, 1.5e8 * 1000)).toBeCloseTo(2 * Math.atan(6_371_000 / 1.5e11), 12);
  });

  it('is larger for closer bodies of the same radius', () => {
    const near = angularSize(1000, 1e6);
    const far = angularSize(1000, 1e9);
    expect(near).toBeGreaterThan(far);
  });

  it('handles zero distance without throwing', () => {
    expect(angularSize(1000, 0)).toBe(Math.PI);
  });
});

describe('sunBrightness', () => {
  it('is proportional to 1/d^2, normalized to 1 at referenceDistance', () => {
    const ref = 1.5e11;
    expect(sunBrightness(ref, ref)).toBeCloseTo(1, 9);
    expect(sunBrightness(2 * ref, ref)).toBeCloseTo(0.25, 9);
    expect(sunBrightness(ref / 2, ref)).toBeCloseTo(4, 9);
  });
});

describe('phaseAngle / phaseFactor', () => {
  it('phase 0 (same direction) gives a full phaseFactor of 1', () => {
    const p = phaseAngle({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(p).toBeCloseTo(0, 9);
    expect(phaseFactor(p)).toBeCloseTo(1, 9);
  });

  it('phase PI (opposite direction) gives a phaseFactor of 0', () => {
    const p = phaseAngle({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 });
    expect(p).toBeCloseTo(Math.PI, 9);
    expect(phaseFactor(p)).toBeCloseTo(0, 9);
  });

  it('phaseFactor stays within [0, 1] across the full angle range', () => {
    for (let deg = 0; deg <= 180; deg += 15) {
      const f = phaseFactor((deg * Math.PI) / 180);
      expect(f).toBeGreaterThanOrEqual(-1e-12);
      expect(f).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('returns 0 for a degenerate zero-length input vector', () => {
    expect(phaseAngle({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBe(0);
  });
});

describe('reflectedBrightness', () => {
  it('reads 1 at full phase when both distances equal the reference (1 AU)', () => {
    const ref = 1.5e11;
    const full = reflectedBrightness(ref, ref, ref, 0);
    const dark = reflectedBrightness(ref, ref, ref, Math.PI);
    expect(full).toBeCloseTo(1, 9);
    expect(dark).toBeCloseTo(0, 9);
  });

  it('scales as 1/d^2 in observer distance', () => {
    const ref = 1.5e11;
    const near = reflectedBrightness(ref, ref, ref, 0);
    const far = reflectedBrightness(2 * ref, ref, ref, 0);
    expect(far).toBeCloseTo(near / 4, 9);
  });

  it('falls off as 1/solarDistance^2 (a body twice as far from the Sun is 1/4 as lit)', () => {
    const ref = 1.5e11;
    const nearSun = reflectedBrightness(ref, ref, ref, 0);
    const farSun = reflectedBrightness(ref, 2 * ref, ref, 0);
    expect(farSun).toBeCloseTo(nearSun / 4, 9);
  });

  it('returns +Infinity for a degenerate (<=0) distance', () => {
    expect(reflectedBrightness(0, 1e11, 1e11, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(reflectedBrightness(1e11, 0, 1e11, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

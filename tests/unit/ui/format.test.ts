import { describe, expect, it } from 'vitest';
import { fmtKm, fmtKmPerS, fmtDegrees } from '../../../src/ui/format';

describe('fmtKm', () => {
  it('converts meters to a km-labelled, comma-grouped string', () => {
    expect(fmtKm(1_500_000)).toBe('1,500 km');
  });

  it('supports fractional digits', () => {
    expect(fmtKm(1_234, 2)).toBe('1.23 km');
  });
});

describe('fmtKmPerS', () => {
  it('converts m/s to a km/s-labelled string', () => {
    expect(fmtKmPerS(7500)).toBe('7.500 km/s');
  });
});

describe('fmtDegrees', () => {
  it('converts radians to a degree-labelled string', () => {
    expect(fmtDegrees(Math.PI)).toBe('180.00°');
  });
});

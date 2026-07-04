import { describe, expect, it } from 'vitest';
import { interpolateEphemeris } from '../../src/core/ephemerisInterp';

describe('interpolateEphemeris', () => {
  it('is not implemented yet', () => {
    expect(() => interpolateEphemeris([], 0)).toThrow('not implemented');
  });
});

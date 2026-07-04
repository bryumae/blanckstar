import { describe, expect, it } from 'vitest';
import { gravityAcceleration } from '../../src/core/gravity';

describe('gravityAcceleration', () => {
  it('is not implemented yet', () => {
    const origin = { x: 0, y: 0, z: 0 };
    expect(() => gravityAcceleration(origin, { sun: origin, earth: origin, moon: origin })).toThrow(
      'not implemented',
    );
  });
});

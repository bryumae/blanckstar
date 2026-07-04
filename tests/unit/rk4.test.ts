import { describe, expect, it } from 'vitest';
import { rk4Step } from '../../src/core/rk4';

describe('rk4Step', () => {
  it('is not implemented yet', () => {
    const state = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } };
    expect(() => rk4Step(state, 0, 1, () => ({ x: 0, y: 0, z: 0 }))).toThrow('not implemented');
  });
});

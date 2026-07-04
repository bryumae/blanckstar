import { describe, expect, it } from 'vitest';
import { orbitalElementsFromState } from '../../src/core/orbitalElements';

describe('orbitalElementsFromState', () => {
  it('is not implemented yet', () => {
    const origin = { x: 0, y: 0, z: 0 };
    expect(() => orbitalElementsFromState(origin, origin, 1)).toThrow('not implemented');
  });
});

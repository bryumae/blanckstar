import { describe, expect, it } from 'vitest';
import { candidateToIdentified, pickNearest, pickToleranceRadians, type PickCandidate } from '../../../src/render/picking';

const CANDIDATES: PickCandidate[] = [
  { kind: 'body', id: 'earth', name: 'Earth', bodyId: 'earth', direction: { x: 1, y: 0, z: 0 } },
  { kind: 'body', id: 'mars', name: 'Mars', bodyId: 'mars', direction: { x: 0, y: 1, z: 0 } },
  { kind: 'star', id: 'star:0', name: 'Vega', direction: { x: 0, y: 0, z: 1 } },
];

describe('pickNearest', () => {
  it('picks the candidate closest in angle to the ray', () => {
    const hit = pickNearest({ x: 1, y: 0.01, z: 0 }, CANDIDATES, 0.1);
    expect(hit?.id).toBe('earth');
  });

  it('returns null when nothing is within the tolerance', () => {
    const hit = pickNearest({ x: -1, y: 0, z: 0 }, CANDIDATES, 0.05);
    expect(hit).toBeNull();
  });

  it('returns null for an empty candidate list', () => {
    expect(pickNearest({ x: 1, y: 0, z: 0 }, [], 1)).toBeNull();
  });

  it('picks exactly the candidate at the tolerance boundary', () => {
    // Angle between (1,0,0) and (cos(0.05), sin(0.05), 0) is exactly 0.05 rad.
    const ray = { x: Math.cos(0.05), y: Math.sin(0.05), z: 0 };
    const hit = pickNearest(ray, CANDIDATES, 0.05 + 1e-9);
    expect(hit?.id).toBe('earth');
    const miss = pickNearest(ray, CANDIDATES, 0.05 - 1e-6);
    expect(miss).toBeNull();
  });
});

describe('candidateToIdentified', () => {
  it('carries bodyId through for bodies', () => {
    const identified = candidateToIdentified(CANDIDATES[0]!);
    expect(identified).toEqual({ kind: 'body', id: 'earth', name: 'Earth', bodyId: 'earth' });
  });

  it('omits bodyId for stars', () => {
    const identified = candidateToIdentified(CANDIDATES[2]!);
    expect(identified).toEqual({ kind: 'star', id: 'star:0', name: 'Vega' });
    expect('bodyId' in identified).toBe(false);
  });
});

describe('pickToleranceRadians', () => {
  it('scales linearly with FOV', () => {
    const t1 = pickToleranceRadians(60, 800);
    const t2 = pickToleranceRadians(30, 800);
    expect(t1).toBeCloseTo(t2 * 2, 9);
  });

  it('scales inversely with canvas height', () => {
    const t1 = pickToleranceRadians(60, 800);
    const t2 = pickToleranceRadians(60, 1600);
    expect(t1).toBeCloseTo(t2 * 2, 9);
  });
});

import { describe, expect, it } from 'vitest';
import { renderPosition } from '../../src/core/floatingOrigin';

describe('renderPosition', () => {
  it('places the ship at the render origin regardless of absolute position', () => {
    const ship = { x: 1.5e11, y: -3e10, z: 7e9 };
    expect(renderPosition(ship, ship, 1e-9)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('scales the body offset from the ship', () => {
    const ship = { x: 1e11, y: 0, z: 0 };
    const body = { x: 1e11 + 1e9, y: 2e9, z: -4e9 };
    const scale = 1e-9;
    const r = renderPosition(body, ship, scale);
    expect(r.x).toBeCloseTo(1, 9);
    expect(r.y).toBeCloseTo(2, 9);
    expect(r.z).toBeCloseTo(-4, 9);
  });
});

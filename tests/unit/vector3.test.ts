import { describe, expect, it } from 'vitest';
import { add, angleBetween, cross, dot, mul, norm, normalize, sub, vec3 } from '../../src/core/vector3';

describe('vector3', () => {
  it('adds and subtracts', () => {
    expect(add(vec3(1, 2, 3), vec3(4, 5, 6))).toEqual({ x: 5, y: 7, z: 9 });
    expect(sub(vec3(4, 5, 6), vec3(1, 2, 3))).toEqual({ x: 3, y: 3, z: 3 });
  });

  it('scales', () => {
    expect(mul(vec3(1, 2, 3), 2)).toEqual({ x: 2, y: 4, z: 6 });
  });

  it('computes dot and cross products', () => {
    expect(dot(vec3(1, 0, 0), vec3(0, 1, 0))).toBe(0);
    expect(cross(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('computes norm and normalize', () => {
    expect(norm(vec3(3, 4, 0))).toBe(5);
    expect(normalize(vec3(3, 4, 0))).toEqual({ x: 0.6, y: 0.8, z: 0 });
  });

  it('computes angle between vectors', () => {
    expect(angleBetween(vec3(1, 0, 0), vec3(0, 1, 0))).toBeCloseTo(Math.PI / 2);
  });
});

// Pure calculator logic (src/ui/sequence/tabs/calculator.ts, mvp0_spec.md §7.6).
import { describe, it, expect } from 'vitest';
import {
  CALC_OPERATIONS,
  calcOperationInfo,
  evaluateCalc,
  radToDeg,
  degToRad,
} from '../../src/ui/sequence/tabs/calculator';

const A = { x: 1, y: 0, z: 0 };
const B = { x: 0, y: 1, z: 0 };

describe('evaluateCalc', () => {
  it('dot(A, B)', () => {
    expect(evaluateCalc('dot', A, B, 0)).toEqual({ kind: 'scalar', value: 0 });
    expect(evaluateCalc('dot', A, A, 0)).toEqual({ kind: 'scalar', value: 1 });
  });

  it('cross(A, B)', () => {
    const r = evaluateCalc('cross', A, B, 0);
    expect(r).toEqual({ kind: 'vector', value: { x: 0, y: 0, z: 1 } });
  });

  it('angleBetween(A, B) is 90 degrees for orthogonal unit vectors', () => {
    const r = evaluateCalc('angleBetween', A, B, 0);
    expect(r.kind).toBe('scalar');
    expect((r as { value: number }).value).toBeCloseTo(Math.PI / 2, 10);
  });

  it('norm(A)', () => {
    expect(evaluateCalc('norm', { x: 3, y: 4, z: 0 }, B, 0)).toEqual({ kind: 'scalar', value: 5 });
  });

  it('normalize(A)', () => {
    const r = evaluateCalc('normalize', { x: 3, y: 4, z: 0 }, B, 0);
    expect(r.kind).toBe('vector');
    const v = (r as { value: { x: number; y: number; z: number } }).value;
    expect(v.x).toBeCloseTo(0.6, 10);
    expect(v.y).toBeCloseTo(0.8, 10);
  });

  it('add / sub', () => {
    expect(evaluateCalc('add', A, B, 0)).toEqual({ kind: 'vector', value: { x: 1, y: 1, z: 0 } });
    expect(evaluateCalc('sub', A, B, 0)).toEqual({ kind: 'vector', value: { x: 1, y: -1, z: 0 } });
  });

  it('scale uses the scalar input', () => {
    expect(evaluateCalc('scale', A, B, 5)).toEqual({ kind: 'vector', value: { x: 5, y: 0, z: 0 } });
  });

  it('trig ops operate on the scalar (radians)', () => {
    expect(evaluateCalc('sin', A, B, 0)).toEqual({ kind: 'scalar', value: 0 });
    expect((evaluateCalc('cos', A, B, 0) as { value: number }).value).toBeCloseTo(1, 10);
    expect((evaluateCalc('tan', A, B, 0) as { value: number }).value).toBeCloseTo(0, 10);
    expect((evaluateCalc('asin', A, B, 1) as { value: number }).value).toBeCloseTo(Math.PI / 2, 10);
    expect((evaluateCalc('acos', A, B, 1) as { value: number }).value).toBeCloseTo(0, 10);
  });

  it('atan2 takes both scalar arguments', () => {
    const r = evaluateCalc('atan2', A, B, 1, 1);
    expect((r as { value: number }).value).toBeCloseTo(Math.PI / 4, 10);
  });

  it('throws on an unknown operation', () => {
    expect(() => evaluateCalc('bogus' as never, A, B, 0)).toThrow();
  });
});

describe('calcOperationInfo', () => {
  it('finds every declared operation', () => {
    for (const op of CALC_OPERATIONS) {
      expect(calcOperationInfo(op.id)).toBe(op);
    }
  });

  it('throws for an unknown id', () => {
    expect(() => calcOperationInfo('nope' as never)).toThrow();
  });
});

describe('radToDeg / degToRad', () => {
  it('round-trips', () => {
    expect(radToDeg(Math.PI)).toBeCloseTo(180, 10);
    expect(degToRad(180)).toBeCloseTo(Math.PI, 10);
    expect(degToRad(radToDeg(1.23456))).toBeCloseTo(1.23456, 10);
  });
});

// Pure compute logic for the Calculator tab (mvp0_spec.md §7.6): scalar/vector
// operations over two input vectors (A, B) and an optional scalar, built only
// from src/core/vector3. No DOM here — the tab UI drives this module and
// formats its output.
import type { Vector3 } from '../../../core/vector3';
import { add, sub, mul, dot, cross, norm, normalize, angleBetween } from '../../../core/vector3';

export type CalcOperation =
  | 'dot'
  | 'cross'
  | 'angleBetween'
  | 'norm'
  | 'normalize'
  | 'add'
  | 'sub'
  | 'scale'
  | 'sin'
  | 'cos'
  | 'tan'
  | 'asin'
  | 'acos'
  | 'atan2';

export interface CalcOperationInfo {
  readonly id: CalcOperation;
  readonly label: string;
  readonly usesA: boolean;
  readonly usesB: boolean;
  readonly usesScalar: boolean;
  readonly resultKind: 'vector' | 'scalar';
}

// Ordered for the operation picker; vector ops first, then scalar trig.
export const CALC_OPERATIONS: readonly CalcOperationInfo[] = [
  { id: 'dot', label: 'dot(A, B)', usesA: true, usesB: true, usesScalar: false, resultKind: 'scalar' },
  { id: 'cross', label: 'cross(A, B)', usesA: true, usesB: true, usesScalar: false, resultKind: 'vector' },
  { id: 'angleBetween', label: 'angleBetween(A, B)', usesA: true, usesB: true, usesScalar: false, resultKind: 'scalar' },
  { id: 'norm', label: 'norm(A)', usesA: true, usesB: false, usesScalar: false, resultKind: 'scalar' },
  { id: 'normalize', label: 'normalize(A)', usesA: true, usesB: false, usesScalar: false, resultKind: 'vector' },
  { id: 'add', label: 'A + B', usesA: true, usesB: true, usesScalar: false, resultKind: 'vector' },
  { id: 'sub', label: 'A − B', usesA: true, usesB: true, usesScalar: false, resultKind: 'vector' },
  { id: 'scale', label: 'A × scalar', usesA: true, usesB: false, usesScalar: true, resultKind: 'vector' },
  { id: 'sin', label: 'sin(scalar)', usesA: false, usesB: false, usesScalar: true, resultKind: 'scalar' },
  { id: 'cos', label: 'cos(scalar)', usesA: false, usesB: false, usesScalar: true, resultKind: 'scalar' },
  { id: 'tan', label: 'tan(scalar)', usesA: false, usesB: false, usesScalar: true, resultKind: 'scalar' },
  { id: 'asin', label: 'asin(scalar)', usesA: false, usesB: false, usesScalar: true, resultKind: 'scalar' },
  { id: 'acos', label: 'acos(scalar)', usesA: false, usesB: false, usesScalar: true, resultKind: 'scalar' },
  { id: 'atan2', label: 'atan2(scalar, scalarB)', usesA: false, usesB: false, usesScalar: true, resultKind: 'scalar' },
];

export function calcOperationInfo(op: CalcOperation): CalcOperationInfo {
  const info = CALC_OPERATIONS.find((o) => o.id === op);
  if (!info) throw new Error(`calculator: unknown operation "${op}"`);
  return info;
}

export type CalcResult = { readonly kind: 'vector'; readonly value: Vector3 } | { readonly kind: 'scalar'; readonly value: number };

// `scalar` doubles as the second scalar argument for atan2(scalar, scalarB).
export function evaluateCalc(op: CalcOperation, a: Vector3, b: Vector3, scalar: number, scalarB = 0): CalcResult {
  switch (op) {
    case 'dot':
      return { kind: 'scalar', value: dot(a, b) };
    case 'cross':
      return { kind: 'vector', value: cross(a, b) };
    case 'angleBetween':
      return { kind: 'scalar', value: angleBetween(a, b) };
    case 'norm':
      return { kind: 'scalar', value: norm(a) };
    case 'normalize':
      return { kind: 'vector', value: normalize(a) };
    case 'add':
      return { kind: 'vector', value: add(a, b) };
    case 'sub':
      return { kind: 'vector', value: sub(a, b) };
    case 'scale':
      return { kind: 'vector', value: mul(a, scalar) };
    case 'sin':
      return { kind: 'scalar', value: Math.sin(scalar) };
    case 'cos':
      return { kind: 'scalar', value: Math.cos(scalar) };
    case 'tan':
      return { kind: 'scalar', value: Math.tan(scalar) };
    case 'asin':
      return { kind: 'scalar', value: Math.asin(scalar) };
    case 'acos':
      return { kind: 'scalar', value: Math.acos(scalar) };
    case 'atan2':
      return { kind: 'scalar', value: Math.atan2(scalar, scalarB) };
    default: {
      const exhaustive: never = op;
      throw new Error(`calculator: unhandled operation "${exhaustive as string}"`);
    }
  }
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

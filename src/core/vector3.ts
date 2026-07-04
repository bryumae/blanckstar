// Pure 3-vector math. No DOM, no worker globals. SI units throughout (mvp0_spec.md §4.1).
export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function vec3(x: number, y: number, z: number): Vector3 {
  return { x, y, z };
}

export function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function mul(a: Vector3, s: number): Vector3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function norm(a: Vector3): number {
  return Math.sqrt(dot(a, a));
}

export function normalize(a: Vector3): Vector3 {
  const n = norm(a);
  return { x: a.x / n, y: a.y / n, z: a.z / n };
}

export function angleBetween(a: Vector3, b: Vector3): number {
  return Math.acos(dot(normalize(a), normalize(b)));
}

// Cubic Hermite interpolation of position + velocity over uniformly-spaced
// ephemeris samples (mvp0_spec.md §4.5). Each sample carries both position and
// velocity, so on any interval [t_i, t_{i+1}] we have the two endpoint positions
// plus the two endpoint tangents (velocities) — exactly what a cubic Hermite
// segment needs. Position is the Hermite cubic; velocity is its analytic
// derivative, so an interpolated pair stays self-consistent (d/dt of the
// position interpolant equals the velocity interpolant).
import type { Vector3 } from './vector3';
import type { BodyEphemeris, BodyId, EphemerisData } from './ephemerisTypes';

export interface EphemerisSample {
  readonly t: number;
  readonly position: Vector3;
  readonly velocity: Vector3;
}

// Hermite basis on the unit interval s in [0,1] and its derivative w.r.t. s.
// p(s)  = h00*p0 + h10*m0 + h01*p1 + h11*m1
// where m0, m1 are tangents scaled by the interval length h (m = v*h).
function hermite(p0: number, v0: number, p1: number, v1: number, s: number, h: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * p0 + h10 * (v0 * h) + h01 * p1 + h11 * (v1 * h);
}

// Derivative of the Hermite cubic with respect to time t (chain rule: ds/dt = 1/h).
function hermiteDerivative(p0: number, v0: number, p1: number, v1: number, s: number, h: number): number {
  const s2 = s * s;
  const d00 = 6 * s2 - 6 * s;
  const d10 = 3 * s2 - 4 * s + 1;
  const d01 = -6 * s2 + 6 * s;
  const d11 = 3 * s2 - 2 * s;
  const dpds = d00 * p0 + d10 * (v0 * h) + d01 * p1 + d11 * (v1 * h);
  return dpds / h;
}

function interpolateSegment(a: EphemerisSample, b: EphemerisSample, t: number): EphemerisSample {
  const h = b.t - a.t;
  const s = (t - a.t) / h;
  return {
    t,
    position: {
      x: hermite(a.position.x, a.velocity.x, b.position.x, b.velocity.x, s, h),
      y: hermite(a.position.y, a.velocity.y, b.position.y, b.velocity.y, s, h),
      z: hermite(a.position.z, a.velocity.z, b.position.z, b.velocity.z, s, h),
    },
    velocity: {
      x: hermiteDerivative(a.position.x, a.velocity.x, b.position.x, b.velocity.x, s, h),
      y: hermiteDerivative(a.position.y, a.velocity.y, b.position.y, b.velocity.y, s, h),
      z: hermiteDerivative(a.position.z, a.velocity.z, b.position.z, b.velocity.z, s, h),
    },
  };
}

// Interpolate over an explicit array of samples (must be time-sorted, >= 2).
// t outside [samples[0].t, samples[last].t] throws.
export function interpolateEphemeris(samples: readonly EphemerisSample[], t: number): EphemerisSample {
  if (samples.length < 2) {
    throw new Error('interpolateEphemeris: need at least two samples');
  }
  // length >= 2 guarantees these indices exist.
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  if (t < first.t || t > last.t) {
    throw new Error(
      `interpolateEphemeris: t=${t} outside sample coverage [${first.t}, ${last.t}]`,
    );
  }
  // Locate the segment [samples[i], samples[i+1]] containing t via binary search.
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.t <= t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return interpolateSegment(samples[lo]!, samples[hi]!, t);
}

// ---- JSON-schema convenience layer (mvp0_spec.md §4.5) ----
// Interpolate directly on a BodyEphemeris (uniformly spaced [x,y,z,vx,vy,vz]
// samples at t0 + i*dt) without materializing an EphemerisSample array.

function bodySampleAt(body: BodyEphemeris, i: number): EphemerisSample {
  const s = body.samples[i]!; // callers pass in-range indices
  return {
    t: body.t0 + i * body.dt,
    position: { x: s[0], y: s[1], z: s[2] },
    velocity: { x: s[3], y: s[4], z: s[5] },
  };
}

function interpolateBody(body: BodyEphemeris, t: number): EphemerisSample {
  const n = body.samples.length;
  if (n < 2) {
    throw new Error('ephemeris: body needs at least two samples');
  }
  const tEnd = body.t0 + (n - 1) * body.dt;
  if (t < body.t0 || t > tEnd) {
    throw new Error(`ephemeris: t=${t} outside coverage [${body.t0}, ${tEnd}]`);
  }
  // Index of the left endpoint; clamp so the last sample uses segment [n-2, n-1].
  let i = Math.floor((t - body.t0) / body.dt);
  if (i >= n - 1) {
    i = n - 2;
  }
  return interpolateSegment(bodySampleAt(body, i), bodySampleAt(body, i + 1), t);
}

function requireBody(data: EphemerisData, body: BodyId): BodyEphemeris {
  const b = data.bodies[body];
  if (!b) {
    throw new Error(`ephemeris: no data for body "${body}"`);
  }
  return b;
}

// Interpolated position of a body at time t. Throws if the body is absent or t
// is out of coverage.
export function positionAt(data: EphemerisData, body: BodyId, t: number): Vector3 {
  return interpolateBody(requireBody(data, body), t).position;
}

// Interpolated velocity of a body at time t (Hermite derivative).
export function velocityAt(data: EphemerisData, body: BodyId, t: number): Vector3 {
  return interpolateBody(requireBody(data, body), t).velocity;
}

// Interpolated position + velocity of a body at time t.
export function stateAt(data: EphemerisData, body: BodyId, t: number): EphemerisSample {
  return interpolateBody(requireBody(data, body), t);
}

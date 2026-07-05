import { describe, expect, it } from 'vitest';
import { rk4Step, type State, type Acceleration } from '../../src/core/rk4';
import { gravityAcceleration } from '../../src/core/gravity';
import { MU_EARTH, R_EARTH } from '../../src/core/constants';
import { norm, sub } from '../../src/core/vector3';

const ORIGIN = { x: 0, y: 0, z: 0 };

// Central-body gravity about a body fixed at the origin, for two-body checks.
function centralGravity(mu: number): Acceleration {
  return (s: State) => {
    const r = norm(s.position);
    const f = -mu / (r * r * r);
    return { x: s.position.x * f, y: s.position.y * f, z: s.position.z * f };
  };
}

// Specific orbital energy about a body at the origin.
function energy(s: State, mu: number): number {
  const r = norm(s.position);
  const v = norm(s.velocity);
  return (v * v) / 2 - mu / r;
}

describe('rk4Step', () => {
  it('integrates constant velocity exactly (zero acceleration)', () => {
    const s: State = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 2, y: -3, z: 1 } };
    const next = rk4Step(s, 0, 10, () => ORIGIN);
    expect(next.position.x).toBeCloseTo(20, 9);
    expect(next.position.y).toBeCloseTo(-30, 9);
    expect(next.position.z).toBeCloseTo(10, 9);
    expect(next.velocity).toEqual(s.velocity);
  });

  it('integrates constant acceleration to 4th order (exact for a cubic)', () => {
    // x(t) = x0 + v0 t + 1/2 a t^2 is a polynomial of degree 2; RK4 is exact.
    const a = { x: 1, y: 0.5, z: -2 };
    const s: State = { position: { x: 3, y: 0, z: 0 }, velocity: { x: 1, y: 2, z: 0 } };
    const dt = 5;
    const next = rk4Step(s, 0, dt, () => a);
    expect(next.position.x).toBeCloseTo(3 + 1 * dt + 0.5 * a.x * dt * dt, 6);
    expect(next.position.y).toBeCloseTo(0 + 2 * dt + 0.5 * a.y * dt * dt, 6);
    expect(next.position.z).toBeCloseTo(0 + 0 + 0.5 * a.z * dt * dt, 6);
    expect(next.velocity.x).toBeCloseTo(1 + a.x * dt, 9);
  });

  it('propagates a circular Earth orbit with correct period (<0.1%)', () => {
    const r = R_EARTH + 500_000; // 500 km altitude
    const vCirc = Math.sqrt(MU_EARTH / r);
    const period = 2 * Math.PI * Math.sqrt((r * r * r) / MU_EARTH);
    let s: State = { position: { x: r, y: 0, z: 0 }, velocity: { x: 0, y: vCirc, z: 0 } };

    const accel = centralGravity(MU_EARTH);
    const steps = 2000;
    const dt = period / steps;
    for (let i = 0; i < steps; i++) {
      s = rk4Step(s, i * dt, dt, accel);
    }
    // After one full period the ship should return near its start.
    const drift = norm(sub(s.position, { x: r, y: 0, z: 0 }));
    expect(drift / r).toBeLessThan(1e-3); // < 0.1% of orbit radius
  });

  it('conserves specific orbital energy over one orbit (tiny drift)', () => {
    const r = R_EARTH + 500_000;
    const vCirc = Math.sqrt(MU_EARTH / r);
    const period = 2 * Math.PI * Math.sqrt((r * r * r) / MU_EARTH);
    let s: State = { position: { x: r, y: 0, z: 0 }, velocity: { x: 0, y: vCirc, z: 0 } };
    const e0 = energy(s, MU_EARTH);
    const accel = centralGravity(MU_EARTH);
    const steps = 2000;
    const dt = period / steps;
    for (let i = 0; i < steps; i++) {
      s = rk4Step(s, i * dt, dt, accel);
    }
    const e1 = energy(s, MU_EARTH);
    expect(Math.abs((e1 - e0) / e0)).toBeLessThan(1e-6);
  });

  it('matches an analytic elliptic two-body position after half a period', () => {
    // Elliptic orbit with periapsis at x=r_p, apoapsis at x=-r_a. Starting at
    // periapsis, after half a period the ship is at apoapsis on the -x axis.
    const rp = R_EARTH + 500_000;
    const e = 0.3;
    const a = rp / (1 - e);
    const ra = a * (1 + e);
    const vp = Math.sqrt(MU_EARTH * (2 / rp - 1 / a));
    const period = 2 * Math.PI * Math.sqrt((a * a * a) / MU_EARTH);
    let s: State = { position: { x: rp, y: 0, z: 0 }, velocity: { x: 0, y: vp, z: 0 } };
    const accel = centralGravity(MU_EARTH);
    const steps = 4000;
    const dt = period / 2 / steps;
    for (let i = 0; i < steps; i++) {
      s = rk4Step(s, i * dt, dt, accel);
    }
    expect(s.position.x).toBeCloseTo(-ra, 0); // within ~1 m of apoapsis distance
    expect(Math.abs(s.position.y) / ra).toBeLessThan(1e-4);
  });

  it('is deterministic: identical inputs produce bit-identical outputs', () => {
    const bodies = { sun: { x: 1e11, y: 0, z: 0 }, earth: ORIGIN, moon: { x: 3.8e8, y: 0, z: 0 } };
    const accel: Acceleration = (state) => gravityAcceleration(state.position, bodies);
    const s: State = { position: { x: R_EARTH + 700_000, y: 1000, z: -500 }, velocity: { x: 10, y: 7600, z: 3 } };
    let a = s;
    let b = s;
    for (let i = 0; i < 100; i++) {
      a = rk4Step(a, i * 10, 10, accel);
      b = rk4Step(b, i * 10, 10, accel);
    }
    expect(a).toEqual(b);
  });
});

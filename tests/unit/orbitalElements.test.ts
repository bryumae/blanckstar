import { describe, expect, it } from 'vitest';
import { orbitalElementsFromState } from '../../src/core/orbitalElements';
import { MU_EARTH } from '../../src/core/constants';

describe('orbitalElementsFromState', () => {
  it('recovers a circular equatorial orbit', () => {
    const r = 7_000_000;
    const v = Math.sqrt(MU_EARTH / r);
    const el = orbitalElementsFromState({ x: r, y: 0, z: 0 }, { x: 0, y: v, z: 0 }, MU_EARTH);
    expect(el.eccentricity).toBeCloseTo(0, 6);
    expect(el.semiMajorAxis).toBeCloseTo(r, 3);
    expect(el.inclination).toBeCloseTo(0, 6);
    expect(el.periapsis).toBeCloseTo(r, 3);
    expect(el.apoapsis).toBeCloseTo(r, 3);
    expect(el.period).toBeCloseTo(2 * Math.PI * Math.sqrt((r * r * r) / MU_EARTH), 3);
    expect(el.specificEnergy).toBeLessThan(0);
  });

  it('recovers an elliptic orbit with periapsis/apoapsis as center distances', () => {
    // Construct at periapsis on +x with velocity along +y.
    const rp = 7_000_000;
    const e = 0.4;
    const a = rp / (1 - e);
    const ra = a * (1 + e);
    const vp = Math.sqrt(MU_EARTH * (2 / rp - 1 / a));
    const el = orbitalElementsFromState({ x: rp, y: 0, z: 0 }, { x: 0, y: vp, z: 0 }, MU_EARTH);
    expect(el.eccentricity).toBeCloseTo(e, 6);
    expect(el.semiMajorAxis).toBeCloseTo(a, 3);
    expect(el.periapsis).toBeCloseTo(rp, 2);
    expect(el.apoapsis).toBeCloseTo(ra, 2);
    expect(el.inclination).toBeCloseTo(0, 6);
  });

  it('measures inclination against the ecliptic (xy-plane)', () => {
    // Circular orbit in the x-z plane -> inclination 90 degrees.
    const r = 7_000_000;
    const v = Math.sqrt(MU_EARTH / r);
    const el = orbitalElementsFromState({ x: r, y: 0, z: 0 }, { x: 0, y: 0, z: v }, MU_EARTH);
    expect(el.inclination).toBeCloseTo(Math.PI / 2, 6);
  });

  it('reports a retrograde equatorial orbit as inclination 180 degrees', () => {
    const r = 7_000_000;
    const v = Math.sqrt(MU_EARTH / r);
    // Velocity along -y -> angular momentum points to -z -> inclination pi.
    const el = orbitalElementsFromState({ x: r, y: 0, z: 0 }, { x: 0, y: -v, z: 0 }, MU_EARTH);
    expect(el.inclination).toBeCloseTo(Math.PI, 6);
  });

  it('handles a 30-degree inclined circular orbit', () => {
    const r = 7_000_000;
    const v = Math.sqrt(MU_EARTH / r);
    const inc = (30 * Math.PI) / 180;
    // Velocity tilted out of the ecliptic by `inc` about the x-axis.
    const el = orbitalElementsFromState(
      { x: r, y: 0, z: 0 },
      { x: 0, y: v * Math.cos(inc), z: v * Math.sin(inc) },
      MU_EARTH,
    );
    expect(el.inclination).toBeCloseTo(inc, 6);
    expect(el.eccentricity).toBeCloseTo(0, 6);
  });

  it('computes elements relative to a moving center', () => {
    // Earth at (R,0,0) moving at (0,V,0); ship in a circular orbit about it.
    const R = 1.5e11;
    const V = 29_780;
    const r = 7_000_000;
    const vc = Math.sqrt(MU_EARTH / r);
    const el = orbitalElementsFromState(
      { x: R + r, y: 0, z: 0 },
      { x: 0, y: V + vc, z: 0 },
      MU_EARTH,
      { x: R, y: 0, z: 0 },
      { x: 0, y: V, z: 0 },
    );
    expect(el.eccentricity).toBeCloseTo(0, 6);
    expect(el.semiMajorAxis).toBeCloseTo(r, 3);
  });

  it('reports a hyperbolic orbit with no apoapsis or period', () => {
    const rp = 7_000_000;
    const vEsc = Math.sqrt((2 * MU_EARTH) / rp);
    const el = orbitalElementsFromState({ x: rp, y: 0, z: 0 }, { x: 0, y: vEsc * 1.2, z: 0 }, MU_EARTH);
    expect(el.eccentricity).toBeGreaterThan(1);
    expect(el.specificEnergy).toBeGreaterThan(0);
    expect(el.semiMajorAxis).toBeLessThan(0);
    expect(el.apoapsis).toBe(Infinity);
    expect(el.period).toBeNull();
    // Periapsis stays finite and correct even when unbound.
    expect(el.periapsis).toBeCloseTo(rp, 1);
  });

  it('reports a parabolic (escape) orbit as unbound', () => {
    const rp = 7_000_000;
    const vEsc = Math.sqrt((2 * MU_EARTH) / rp);
    const el = orbitalElementsFromState({ x: rp, y: 0, z: 0 }, { x: 0, y: vEsc, z: 0 }, MU_EARTH);
    expect(el.eccentricity).toBeCloseTo(1, 3);
    expect(el.semiMajorAxis).toBe(Infinity);
    expect(el.apoapsis).toBe(Infinity);
    expect(el.period).toBeNull();
  });

  it('classifies near-parabolic negative-energy orbits as bound from energy alone', () => {
    const rp = 7_000_000;
    const a = 1e15;
    const e = 1 - rp / a;
    const vp = Math.sqrt(MU_EARTH * (2 / rp - 1 / a));
    const el = orbitalElementsFromState({ x: rp, y: 0, z: 0 }, { x: 0, y: vp, z: 0 }, MU_EARTH);

    expect(el.specificEnergy).toBeLessThan(0);
    expect(el.eccentricity).toBeCloseTo(e, 12);
    expect(Math.abs(el.semiMajorAxis - a) / a).toBeLessThan(1e-8);
    expect(Math.abs(el.apoapsis - a * (1 + e)) / (a * (1 + e))).toBeLessThan(1e-8);
    expect(el.period).not.toBeNull();
  });

  it('treats a radial (zero angular momentum) trajectory with inclination 0', () => {
    const el = orbitalElementsFromState({ x: 7_000_000, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, MU_EARTH);
    expect(el.inclination).toBe(0);
  });
});

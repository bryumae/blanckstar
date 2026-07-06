// Classical orbital elements from a state vector relative to a chosen center
// (mvp0_spec.md §7 "Inserted-state orbital information"). The center is the Sun
// for a solar orbit or Earth for an Earth orbit; pass its gravitational
// parameter and (optionally) its position/velocity so the state is reduced to
// center-relative coordinates first. Inclination is measured against the frame's
// xy-plane — the ecliptic — which is the reference plane for both solar and
// Earth orbits in this heliocentric-ecliptic-J2000 frame (§7).
//
// Periapsis/apoapsis are returned as distances from the center of the orbit
// (not altitude above a surface), per §7. Hyperbolic/parabolic orbits have no
// bound apoapsis or period: apoapsis is +Infinity and period is null.
import type { Vector3 } from './vector3';
import { sub, dot, cross, norm } from './vector3';

export interface OrbitalElements {
  readonly semiMajorAxis: number; // m; negative for hyperbolic orbits
  readonly eccentricity: number;
  readonly inclination: number; // radians, vs the ecliptic (xy-plane)
  readonly periapsis: number; // m, distance from center
  readonly apoapsis: number; // m, distance from center; +Infinity if unbound
  readonly specificEnergy: number; // J/kg (m^2/s^2)
  readonly period: number | null; // s; null for parabolic/hyperbolic (unbound)
}

const ZERO: Vector3 = { x: 0, y: 0, z: 0 };
const PARABOLIC_ENERGY_REL_TOL = 1e-12;

export function orbitalElementsFromState(
  position: Vector3,
  velocity: Vector3,
  mu: number,
  centerPosition: Vector3 = ZERO,
  centerVelocity: Vector3 = ZERO,
): OrbitalElements {
  // Reduce to center-relative state.
  const r = sub(position, centerPosition);
  const v = sub(velocity, centerVelocity);
  const rMag = norm(r);
  const vMag = norm(v);

  // Specific orbital energy: v^2/2 - mu/r. Sign determines bound/unbound.
  const specificEnergy = (vMag * vMag) / 2 - mu / rMag;

  // Specific angular momentum h = r x v; |h|^2 gives eccentricity magnitude.
  const h = cross(r, v);
  const hMag = norm(h);

  // Eccentricity vector: e = ((v^2 - mu/r) r - (r·v) v) / mu. Its magnitude is e.
  const rv = dot(r, v);
  const coeffR = (vMag * vMag - mu / rMag) / mu;
  const coeffV = rv / mu;
  const eVec: Vector3 = {
    x: coeffR * r.x - coeffV * v.x,
    y: coeffR * r.y - coeffV * v.y,
    z: coeffR * r.z - coeffV * v.z,
  };
  const eccentricity = norm(eVec);

  // Inclination: angle between the angular-momentum vector and +z (ecliptic
  // normal). i = acos(h_z / |h|), in [0, pi]. Guard the degenerate |h|=0 case
  // (radial trajectory) — inclination is undefined, report 0.
  const inclination = hMag === 0 ? 0 : Math.acos(clamp(h.z / hMag, -1, 1));

  const parabolicEnergyTol = (mu / rMag) * PARABOLIC_ENERGY_REL_TOL;
  const parabolic = Math.abs(specificEnergy) <= parabolicEnergyTol;
  const bound = specificEnergy < -parabolicEnergyTol;

  // Semi-major axis from energy: a = -mu / (2*energy). For parabolic escape,
  // report +Infinity as an explicit unbound sentinel rather than leaking the
  // sign of a near-zero floating-point denominator.
  const semiMajorAxis = parabolic ? Infinity : -mu / (2 * specificEnergy);

  // Periapsis / apoapsis as center distances.
  // For a conic: periapsis = a(1-e). For bound orbits apoapsis = a(1+e).
  // For unbound (e >= 1) there is no apoapsis; use the semi-latus-rectum form
  // for periapsis so it stays finite: r_p = h^2 / (mu (1+e)).
  const periapsis = (hMag * hMag) / (mu * (1 + eccentricity));
  const apoapsis = bound ? semiMajorAxis * (1 + eccentricity) : Infinity;
  const period = bound ? 2 * Math.PI * Math.sqrt((semiMajorAxis * semiMajorAxis * semiMajorAxis) / mu) : null;

  return {
    semiMajorAxis,
    eccentricity,
    inclination,
    periapsis,
    apoapsis,
    specificEnergy,
    period,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

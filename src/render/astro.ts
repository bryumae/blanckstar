// Pure math/logic helpers for the Telescope screen (mvp0_spec.md §7.1).
// No Three.js, no DOM — kept separate from starfield.ts/bodies.ts so it can be
// unit-tested directly (the repo's per-file coverage floor is scoped to
// src/core/, but these are still worth testing as ordinary logic).
import type { Vector3 } from '../core/vector3';
import { angleBetween, norm } from '../core/vector3';

// ---- RA/dec -> unit direction (J2000 equatorial-as-rendered; the star
// catalog and body directions are both plain inertial unit vectors here, so
// no separate equatorial/ecliptic rotation is applied — consistent with
// treating the catalog RA/dec as already expressed in the sim's inertial
// frame per docs/design and the net loader contract). ----
export function raDecToUnit(ra: number, dec: number): Vector3 {
  const cosDec = Math.cos(dec);
  return {
    x: cosDec * Math.cos(ra),
    y: cosDec * Math.sin(ra),
    z: Math.sin(dec),
  };
}

// ---- Magnitude -> point size / alpha for the starfield. ----
// Visual magnitude is a reversed log scale: lower (more negative) = brighter.
// We map the practical bright-star range [-1.5, 6.5] to size/alpha so the
// brightest stars dominate and the faintest are still faintly visible.
export const MAG_BRIGHT = -1.5;
export const MAG_FAINT = 6.5;

function magFraction(mag: number): number {
  const clamped = Math.min(Math.max(mag, MAG_BRIGHT), MAG_FAINT);
  // 1 at the brightest end, 0 at the faintest end.
  return 1 - (clamped - MAG_BRIGHT) / (MAG_FAINT - MAG_BRIGHT);
}

// Point size in (arbitrary) render units; monotonically decreasing in mag.
export function magnitudeToSize(mag: number): number {
  const f = magFraction(mag);
  const MIN_SIZE = 1.0;
  const MAX_SIZE = 6.0;
  return MIN_SIZE + f * f * (MAX_SIZE - MIN_SIZE);
}

// Alpha in [0.15, 1.0]; monotonically decreasing in mag.
export function magnitudeToAlpha(mag: number): number {
  const f = magFraction(mag);
  const MIN_ALPHA = 0.15;
  const MAX_ALPHA = 1.0;
  return MIN_ALPHA + f * (MAX_ALPHA - MIN_ALPHA);
}

// ---- Angular size of a body of radius R at distance d (radians). ----
export function angularSize(radiusMeters: number, distanceMeters: number): number {
  if (distanceMeters <= 0) return Math.PI;
  return 2 * Math.atan(radiusMeters / distanceMeters);
}

// ---- Brightness models (mvp0_spec.md §7.1). ----
// Sun: brightness ∝ 1/d^2.
export function sunBrightness(distanceMeters: number, referenceDistance: number): number {
  if (distanceMeters <= 0) return Number.POSITIVE_INFINITY;
  return (referenceDistance * referenceDistance) / (distanceMeters * distanceMeters);
}

// Phase angle at the body: angle Sun-body-observer(ship). cosPhase = 1 means
// fully lit (sun behind the observer), cosPhase = -1 means fully dark (new).
// phaseFactor maps that to a simple Lambertian-like [0,1] illuminated-fraction
// factor: (1 + cos(phase)) / 2.
export function phaseAngle(sunDirFromBody: Vector3, shipDirFromBody: Vector3): number {
  if (norm(sunDirFromBody) === 0 || norm(shipDirFromBody) === 0) return 0;
  return angleBetween(sunDirFromBody, shipDirFromBody);
}

// Illuminated-fraction factor in [0, 1] from the phase angle (0 = new, PI = full... note:
// phase angle 0 means sun and ship are in the *same* direction from the body,
// i.e. full illumination as seen from the ship; PI means the body is between
// sun and ship — fully dark side toward the ship).
export function phaseFactor(phaseRad: number): number {
  return (1 + Math.cos(phaseRad)) / 2;
}

// Reflected brightness of a body seen from the ship (mvp0_spec.md §7.1:
// `reflected × phase / d²`). The reflected term is the sunlight the body
// actually receives, which falls off as 1/solarDistance² — so a body twice as
// far from the Sun is a quarter as illuminated before the observer-distance and
// phase terms apply. Both distances are normalized against `referenceDistance`
// (1 AU) so a body at 1 AU from the Sun seen from 1 AU away at full phase reads
// 1 (matching sunBrightness's convention). Ignoring the solar-distance term (as
// the previous fixed-1-AU normalization did) modelled every body as receiving
// Earth-level sunlight, making the outer planets far too bright.
export function reflectedBrightness(
  distanceMeters: number,
  solarDistanceMeters: number,
  referenceDistance: number,
  phase: number,
): number {
  if (distanceMeters <= 0 || solarDistanceMeters <= 0) return Number.POSITIVE_INFINITY;
  const incident = (referenceDistance * referenceDistance) / (solarDistanceMeters * solarDistanceMeters);
  return (phaseFactor(phase) * incident * referenceDistance * referenceDistance) / (distanceMeters * distanceMeters);
}

// ---- Local body radii not present in src/core/constants.ts (Mars, Venus,
// Jupiter are visible ephemeris-reference bodies per mvp0_spec.md §4.2, but
// core only defines R_EARTH/R_MOON/R_SUN since those are the gravitating/
// collision bodies). IAU mean radii, meters. ----
export const R_MARS = 3_389_500;
export const R_VENUS = 6_051_800;
export const R_JUPITER = 69_911_000;

// Win / lose predicates (mvp0_spec.md §2). Pure functions over absolute
// heliocentric ecliptic state; the sim worker checks them every integrator step.
import type { Vector3 } from './vector3';
import type { State } from './rk4';
import { sub, norm } from './vector3';
import { MU_EARTH, R_EARTH, R_MOON, R_SUN, R_SOI_EARTH, MIN_SAFE_ALTITUDE } from './constants';

// Earth-relative specific orbital energy: v_rel^2/2 - mu_earth/|r_rel| (§2.1).
function earthRelativeEnergy(shipState: State, earthState: State): number {
  const rRel = sub(shipState.position, earthState.position);
  const vRel = sub(shipState.velocity, earthState.velocity);
  const rMag = norm(rRel);
  const vMag = norm(vRel);
  return (vMag * vMag) / 2 - MU_EARTH / rMag;
}

// Altitude above Earth's surface (meters); negative if below the surface radius.
function altitudeAboveEarth(shipPosition: Vector3, earthPosition: Vector3): number {
  return norm(sub(shipPosition, earthPosition)) - R_EARTH;
}

// Win — Earth capture (§2.1). All three hold simultaneously:
//   inside Earth's sphere of influence,
//   negative Earth-relative specific energy (bound), and
//   altitude above Earth's surface > 120 km.
export function isCaptured(shipState: State, earthState: State): boolean {
  const distanceToEarth = norm(sub(shipState.position, earthState.position));
  const insideSOI = distanceToEarth < R_SOI_EARTH;
  const bound = earthRelativeEnergy(shipState, earthState) < 0;
  const aboveAtmosphere = altitudeAboveEarth(shipState.position, earthState.position) > MIN_SAFE_ALTITUDE;
  return insideSOI && bound && aboveAtmosphere;
}

export type FailureReason = 'earth-atmosphere' | 'moon-collision' | 'sun-collision';

// Lose — destruction (§2.2). Returns the failure reason, or null if the ship is
// intact. Earth atmosphere (altitude < 120 km) is checked first, then lunar
// surface collision, then within 2 solar radii of the Sun.
export function failureCheck(
  shipPosition: Vector3,
  earthPosition: Vector3,
  moonPosition: Vector3,
  sunPosition: Vector3,
): FailureReason | null {
  if (altitudeAboveEarth(shipPosition, earthPosition) < MIN_SAFE_ALTITUDE) {
    return 'earth-atmosphere';
  }
  if (norm(sub(shipPosition, moonPosition)) < R_MOON) {
    return 'moon-collision';
  }
  if (norm(sub(shipPosition, sunPosition)) < 2 * R_SUN) {
    return 'sun-collision';
  }
  return null;
}

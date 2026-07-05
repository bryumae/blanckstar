// Earth-relative derived quantities for the debug panel (mvp0_spec.md §10,
// §2.1 win-condition ingredients). Mirrors the private math in
// src/core/winLose.ts (earthRelativeEnergy / altitudeAboveEarth) — duplicated
// here rather than exported from core because those are intentionally private
// implementation details of the win check, and this file lives outside
// src/core per the repo layer rules (debug mode is src/ui/debug, not core).
import type { Vector3 } from '../../core/vector3';
import { sub, norm } from '../../core/vector3';
import { MU_EARTH, R_EARTH, R_SOI_EARTH } from '../../core/constants';

export interface EarthRelativeState {
  readonly positionRel: Vector3; // m, ship - earth
  readonly velocityRel: Vector3; // m/s, ship - earth
  readonly distance: number; // m, |positionRel|
  readonly speed: number; // m/s, |velocityRel|
  readonly specificEnergy: number; // J/kg, v_rel^2/2 - mu_earth/|r_rel|
  readonly altitude: number; // m above Earth's surface radius (negative if below)
  readonly insideSOI: boolean; // distance < R_SOI_EARTH
  readonly bound: boolean; // specificEnergy < 0
}

export function computeEarthRelativeState(
  shipPosition: Vector3,
  shipVelocity: Vector3,
  earthPosition: Vector3,
  earthVelocity: Vector3,
): EarthRelativeState {
  const positionRel = sub(shipPosition, earthPosition);
  const velocityRel = sub(shipVelocity, earthVelocity);
  const distance = norm(positionRel);
  const speed = norm(velocityRel);
  const specificEnergy = (speed * speed) / 2 - MU_EARTH / distance;
  const altitude = distance - R_EARTH;
  return {
    positionRel,
    velocityRel,
    distance,
    speed,
    specificEnergy,
    altitude,
    insideSOI: distance < R_SOI_EARTH,
    bound: specificEnergy < 0,
  };
}

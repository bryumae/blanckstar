// Solar-system body rendering (mvp0_spec.md §7.1, §4.6). For each visible
// body we solve the light-time emission problem in src/core/lightTime.ts to
// get the apparent (light-time-corrected) direction and distance as seen from
// the ship at receive time tNow, then place a camera-relative render object
// along that direction at a fixed render distance (never raw heliocentric
// meters — see the floating-origin note below).
import * as THREE from 'three';
import type { Vector3 } from '../core/vector3';
import { apparentDirection } from '../core/lightTime';
import { positionAt } from '../core/ephemerisInterp';
import type { EphemerisData } from '../core/ephemerisTypes';
import { R_EARTH, R_MOON, R_SUN } from '../core/constants';
import { R_JUPITER, R_MARS, R_VENUS, angularSize, phaseAngle, reflectedBrightness, sunBrightness } from './astro';
import type { BodyId } from './types';

export const VISIBLE_BODIES: readonly BodyId[] = ['sun', 'earth', 'moon', 'mars', 'venus', 'jupiter'];

const BODY_RADIUS: Record<BodyId, number> = {
  sun: R_SUN,
  earth: R_EARTH,
  moon: R_MOON,
  mars: R_MARS,
  venus: R_VENUS,
  jupiter: R_JUPITER,
};

const BODY_COLOR: Record<BodyId, number> = {
  sun: 0xfff2b0,
  earth: 0x4c8bd9,
  moon: 0xb9b9b9,
  mars: 0xd9764c,
  venus: 0xe0c98a,
  jupiter: 0xd9b98a,
};

// Bodies are placed at a fixed render distance from the camera, scaled by
// apparent angular size, rather than at their true (enormous, floating-
// origin-scaled) distance. This keeps every body comfortably inside the
// camera's near/far planes regardless of the ship's true heliocentric
// distance from it, while preserving the physically correct *direction* and
// *angular size* — the only two things the spec requires be correct for the
// outside/telescope view (no position readout is exposed either way).
export const BODY_RENDER_DISTANCE = 4000; // render units, inside STAR_FIELD_RADIUS

// A body is "resolvable" as a disc once its true angular size exceeds this;
// below it we render a point sprite instead (mvp0_spec.md §7.1: "Bodies far
// away render as points but keep model-based brightness").
export const MIN_RESOLVABLE_ANGULAR_SIZE = 0.01; // radians (~0.57°)

// Reference distance (1 AU) used to normalize brightness magnitudes into a
// convenient ~O(1) range; see astro.ts sunBrightness/reflectedBrightness.
const REFERENCE_DISTANCE = 1.495978707e11;

export interface RenderedBody {
  readonly id: BodyId;
  readonly direction: Vector3; // unit vector, apparent (light-time-corrected)
  readonly distance: number; // true distance, meters
  readonly angularSizeRad: number;
  readonly brightness: number; // arbitrary relative units, higher = brighter
  readonly resolvable: boolean;
  readonly object: THREE.Object3D; // mesh (resolvable) or sprite (point)
}

// Compute the apparent placement + brightness for one body at receive time
// tNow, given the ship's true position. Pure (no THREE) — kept separate from
// the object-construction below so it's independently testable.
export function computeBodyPlacement(
  ephemeris: EphemerisData,
  body: BodyId,
  shipPosition: Vector3,
  tNow: number,
): {
  direction: Vector3;
  distance: number;
  angularSizeRad: number;
  brightness: number;
  resolvable: boolean;
} {
  const bodyPositionAt = (t: number) => positionAt(ephemeris, body, t);
  const apparent = apparentDirection(bodyPositionAt, shipPosition, tNow);
  const angularSizeRad = angularSize(BODY_RADIUS[body], apparent.distance);
  const resolvable = angularSizeRad >= MIN_RESOLVABLE_ANGULAR_SIZE;

  let brightness: number;
  if (body === 'sun') {
    brightness = sunBrightness(apparent.distance, REFERENCE_DISTANCE);
  } else {
    // Phase angle at the body: direction from body to Sun vs. direction from
    // body to ship (using the same emission-time body position for the
    // Sun-direction leg keeps the geometry self-consistent for a "sun is far
    // away" approximation).
    const bodyPosAtEmit = bodyPositionAt(tNow - apparent.lightTime);
    const sunPos = positionAt(ephemeris, 'sun', tNow - apparent.lightTime);
    const sunDirFromBody: Vector3 = {
      x: sunPos.x - bodyPosAtEmit.x,
      y: sunPos.y - bodyPosAtEmit.y,
      z: sunPos.z - bodyPosAtEmit.z,
    };
    const shipDirFromBody: Vector3 = {
      x: shipPosition.x - bodyPosAtEmit.x,
      y: shipPosition.y - bodyPosAtEmit.y,
      z: shipPosition.z - bodyPosAtEmit.z,
    };
    const phase = phaseAngle(sunDirFromBody, shipDirFromBody);
    brightness = reflectedBrightness(apparent.distance, REFERENCE_DISTANCE, phase);
  }

  return { direction: apparent.direction, distance: apparent.distance, angularSizeRad, brightness, resolvable };
}

function makePointSprite(color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, color, transparent: true, depthWrite: false });
  return new THREE.Sprite(material);
}

// Build (or update in place) the THREE objects for every visible body.
export function createBodyObjects(): Record<BodyId, RenderedBody | null> {
  const result = {} as Record<BodyId, RenderedBody | null>;
  for (const id of VISIBLE_BODIES) {
    result[id] = null;
  }
  return result;
}

// Update a single body's THREE object to match its computed placement.
// Brightness maps to sprite/mesh material intensity via a simple log
// compression so both very bright (Sun) and very dim (distant Jupiter) stay
// in a renderable range.
export function updateBodyObject(
  existing: THREE.Object3D | undefined,
  body: BodyId,
  placement: ReturnType<typeof computeBodyPlacement>,
): THREE.Object3D {
  const { direction, angularSizeRad, brightness, resolvable } = placement;
  const pos = new THREE.Vector3(direction.x, direction.y, direction.z).multiplyScalar(BODY_RENDER_DISTANCE);

  const brightnessScale = Math.min(1, Math.max(0.05, Math.log10(1 + brightness * 9) ));

  if (resolvable) {
    let mesh = existing instanceof THREE.Mesh ? existing : undefined;
    if (!mesh) {
      const geometry = new THREE.SphereGeometry(1, 24, 16);
      const material = new THREE.MeshBasicMaterial({ color: BODY_COLOR[body] });
      mesh = new THREE.Mesh(geometry, material);
    }
    // Radius at BODY_RENDER_DISTANCE that subtends angularSizeRad.
    const renderRadius = BODY_RENDER_DISTANCE * Math.tan(angularSizeRad / 2);
    mesh.scale.setScalar(Math.max(renderRadius, 0.5));
    mesh.position.copy(pos);
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(BODY_COLOR[body]).multiplyScalar(brightnessScale);
    mesh.userData.bodyId = body;
    return mesh;
  }

  let sprite = existing instanceof THREE.Sprite ? existing : undefined;
  if (!sprite) {
    sprite = makePointSprite(BODY_COLOR[body]);
  }
  sprite.position.copy(pos);
  const spriteScale = 10 + brightnessScale * 30;
  sprite.scale.set(spriteScale, spriteScale, 1);
  (sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.2 + brightnessScale * 0.8);
  sprite.userData.bodyId = body;
  return sprite;
}

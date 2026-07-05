// Click-to-identify (mvp0_spec.md §7.1): clicking a star or body always
// identifies it — no manual ID puzzle, no search-to-target. This module
// splits the pure "which candidate direction is closest to the click ray"
// logic (independently testable) from the THREE.js raycast plumbing that
// feeds it.
import * as THREE from 'three';
import type { Vector3 } from '../core/vector3';
import type { BodyId, IdentifiedObject } from './types';

export interface PickCandidate {
  readonly kind: 'star' | 'body';
  readonly id: string;
  readonly name: string | null;
  readonly bodyId?: BodyId;
  readonly direction: Vector3; // unit vector from camera/ship
}

// A dot product between two unit vectors is cos(angle); callers rely on that
// to compare against minDot without ever calling acos. Normalize defensively
// here rather than trusting every caller (starfield/body direction sources)
// to hand back exactly unit-length vectors — a non-unit vector would silently
// bias the comparison toward whichever candidate happens to be longer.
function normalize(v: Vector3): Vector3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len === 0) return v;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// Pure nearest-angular-match: given a click ray direction (unit vector) and a
// list of candidate directions, return the candidate with the smallest
// angle to the ray, provided it's within maxAngleRad — otherwise null (click
// missed everything). Angle compared via dot product (monotonic, avoids
// per-candidate acos calls).
export function pickNearest(
  rayDirection: Vector3,
  candidates: readonly PickCandidate[],
  maxAngleRad: number,
): PickCandidate | null {
  if (candidates.length === 0) return null;
  const ray = normalize(rayDirection);
  const minDot = Math.cos(maxAngleRad);
  let best: PickCandidate | null = null;
  let bestDot = -Infinity;
  for (const c of candidates) {
    const dir = normalize(c.direction);
    const dot = ray.x * dir.x + ray.y * dir.y + ray.z * dir.z;
    if (dot > bestDot) {
      bestDot = dot;
      best = c;
    }
  }
  if (best === null || bestDot < minDot) return null;
  return best;
}

export function candidateToIdentified(candidate: PickCandidate): IdentifiedObject {
  return {
    kind: candidate.kind,
    id: candidate.id,
    name: candidate.name,
    ...(candidate.bodyId ? { bodyId: candidate.bodyId } : {}),
  };
}

// Convert a mouse click (CSS pixel coords + canvas size) into a world-space
// ray direction from the camera, using THREE's raycaster. Thin wrapper so
// callers (mount code) don't need to touch THREE directly for this step.
export function screenPointToRayDirection(
  camera: THREE.PerspectiveCamera,
  clientX: number,
  clientY: number,
  canvasRect: { left: number; top: number; width: number; height: number },
): Vector3 {
  const ndcX = ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
  const ndcY = -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const dir = raycaster.ray.direction;
  return { x: dir.x, y: dir.y, z: dir.z };
}

// Maximum angular radius (radians) within which a click counts as a hit.
// Scaled by FOV in the caller (a fixed pixel tolerance corresponds to a
// larger angle at wide FOV, smaller at narrow/telescope FOV); this constant
// is the fixed *pixel* tolerance converted at call time.
export const PICK_TOLERANCE_PX = 18;

export function pickToleranceRadians(fovDeg: number, canvasHeightPx: number): number {
  const fovRad = (fovDeg * Math.PI) / 180;
  return (PICK_TOLERANCE_PX / canvasHeightPx) * fovRad;
}

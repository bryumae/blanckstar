// Fixed background starfield (mvp0_spec.md §7.1): real bright-star catalog,
// rendered as THREE.Points on a large fixed-radius sphere around the camera.
// Stars have no parallax — the point cloud is recentered on the camera every
// frame (never translated by ship motion), so it reads as "fixed on the sky".
import * as THREE from 'three';
import type { StarCatalogEntry } from '../net/loadEphemeris';
import { magnitudeToAlpha, magnitudeToSize, raDecToUnit } from './astro';

// Arbitrary large radius (render units, post floating-origin scale) — far
// beyond any rendered solar-system body so stars never occlude/get occluded
// incorrectly relative to nearer geometry.
export const STAR_FIELD_RADIUS = 5000;

export interface Starfield {
  readonly points: THREE.Points;
  // Call every frame with the camera's world position to keep stars centered
  // on the camera (no parallax).
  update(cameraPosition: THREE.Vector3): void;
}

// THREE.PointsMaterial hard-codes `gl_PointSize = size` from the material's
// scalar `size` uniform, ignoring any per-vertex attribute — so a plain
// per-star `size` attribute renders nothing (every point stays uniform). Patch
// the compiled vertex shader to read a per-vertex `aSize` attribute instead, so
// brighter stars (mapped through magnitudeToSize) render larger. Exported and
// pure (operates on the shader source strings) so the wiring is unit-testable
// without a live WebGL context. Returns whether the expected injection point
// was found (guards against a silent no-op if THREE's shader chunk changes).
export function patchStarSizeShader(shader: { vertexShader: string }): boolean {
  const marker = 'gl_PointSize = size;';
  if (!shader.vertexShader.includes(marker)) return false;
  shader.vertexShader = `attribute float aSize;\n${shader.vertexShader}`.replace(
    marker,
    'gl_PointSize = aSize;',
  );
  return true;
}

export function createStarfield(catalog: readonly StarCatalogEntry[]): Starfield {
  const count = catalog.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const star = catalog[i]!;
    const dir = raDecToUnit(star.ra, star.dec);
    positions[i * 3] = dir.x * STAR_FIELD_RADIUS;
    positions[i * 3 + 1] = dir.y * STAR_FIELD_RADIUS;
    positions[i * 3 + 2] = dir.z * STAR_FIELD_RADIUS;

    const alpha = magnitudeToAlpha(star.mag);
    colors[i * 3] = alpha;
    colors[i * 3 + 1] = alpha;
    colors[i * 3 + 2] = alpha;

    sizes[i] = magnitudeToSize(star.mag);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    size: 2,
    vertexColors: true,
    sizeAttenuation: false,
    transparent: true,
    depthWrite: false,
  });
  // Wire the per-vertex aSize attribute into gl_PointSize (see patchStarSizeShader).
  material.onBeforeCompile = (shader) => {
    patchStarSizeShader(shader);
  };

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    update(cameraPosition: THREE.Vector3): void {
      points.position.copy(cameraPosition);
    },
  };
}

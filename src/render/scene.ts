// Three.js scene/camera bootstrap (mvp0_spec.md §7.1). Thin glue only — math
// like the spacecraft-centered floating-origin transform (§4.6) belongs in
// src/core/, not here.
import * as THREE from 'three';
import type { EphemerisData } from '../core/ephemerisTypes';
import type { StarCatalogEntry } from '../net/loadEphemeris';
import { createStarfield, type Starfield } from './starfield';
import { computeBodyPlacement, updateBodyObject, VISIBLE_BODIES } from './bodies';
import type { RenderFrameState } from './types';
import type { BodyId } from './types';

export type ViewMode = 'outside' | 'telescope';

export const OUTSIDE_FOV_DEG = 60;
export const TELESCOPE_MIN_FOV_DEG = 0.1;
export const TELESCOPE_MAX_FOV_DEG = 45;

// Clamp a candidate FOV (degrees) to the valid range for the given mode.
// Outside view has a single fixed FOV; telescope mode allows zoom within
// [TELESCOPE_MIN_FOV_DEG, TELESCOPE_MAX_FOV_DEG].
export function clampFov(fovDeg: number, mode: ViewMode): number {
  if (mode === 'outside') return OUTSIDE_FOV_DEG;
  return Math.min(TELESCOPE_MAX_FOV_DEG, Math.max(TELESCOPE_MIN_FOV_DEG, fovDeg));
}

// Clamp pitch to just short of the poles to avoid gimbal flip in the look
// direction.
const MAX_PITCH = (Math.PI / 2) * 0.999;

export function clampPitch(pitch: number): number {
  return Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch));
}

// Convert yaw/pitch (radians) to a forward-look unit vector in camera-local
// space (right-handed, -Z forward convention matches THREE's default camera).
export function yawPitchToLookVector(yaw: number, pitch: number): THREE.Vector3 {
  const cosPitch = Math.cos(pitch);
  return new THREE.Vector3(
    Math.sin(yaw) * cosPitch,
    Math.sin(pitch),
    -Math.cos(yaw) * cosPitch,
  ).normalize();
}

export interface Scene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  // Null when a WebGL context can't be created (headless CI without WebGL2, or a
  // machine with WebGL blocked). The scene graph, camera, and picking are all
  // GL-independent, so the telescope still identifies/measures; only pixel
  // rendering is skipped. This keeps a WebGL failure from aborting app boot (it
  // used to throw here and leave every other screen unmounted).
  readonly renderer: THREE.WebGLRenderer | null;
}

export function createScene(canvas: HTMLCanvasElement): Scene {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 1e12);
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Telescope: WebGL unavailable, rendering disabled (identify/measure still work).', err);
  }
  return { scene, camera, renderer };
}

export interface TelescopeViewport {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer | null;
  getMode(): ViewMode;
  setMode(mode: ViewMode): void;
  getFovDeg(): number;
  setFovDeg(fovDeg: number): void;
  zoomBy(deltaDeg: number): void;
  /** Pointer-drag look control. dx/dy in CSS pixels. */
  onDragMove(dx: number, dy: number): void;
  updateFrame(state: RenderFrameState): void;
  render(): void;
  dispose(): void;
}

const LOOK_SENSITIVITY = 0.0025; // radians per CSS pixel at FOV 60; scaled by fov below

export function createTelescopeViewport(
  canvas: HTMLCanvasElement,
  ephemeris: EphemerisData,
  starCatalog: readonly StarCatalogEntry[],
): TelescopeViewport {
  const { scene, camera, renderer } = createScene(canvas);
  camera.fov = OUTSIDE_FOV_DEG;
  camera.updateProjectionMatrix();

  const starfield: Starfield = createStarfield(starCatalog);
  scene.add(starfield.points);

  const bodyObjects = new Map<BodyId, THREE.Object3D>();

  let mode: ViewMode = 'outside';
  let fovDeg = OUTSIDE_FOV_DEG;
  let yaw = 0;
  let pitch = 0;

  function applyLook(): void {
    const look = yawPitchToLookVector(yaw, pitch);
    camera.lookAt(camera.position.clone().add(look));
  }
  applyLook();

  return {
    scene,
    camera,
    renderer,
    getMode: () => mode,
    setMode(next: ViewMode): void {
      mode = next;
      fovDeg = clampFov(fovDeg, mode);
      camera.fov = fovDeg;
      camera.updateProjectionMatrix();
    },
    getFovDeg: () => fovDeg,
    setFovDeg(next: number): void {
      fovDeg = clampFov(next, mode);
      camera.fov = fovDeg;
      camera.updateProjectionMatrix();
    },
    zoomBy(deltaDeg: number): void {
      this.setFovDeg(fovDeg + deltaDeg);
    },
    onDragMove(dx: number, dy: number): void {
      // Scale sensitivity by current FOV so telescope zoom feels proportional
      // (a fixed pixel drag should pan a smaller angle at narrow FOV).
      const scale = (fovDeg / OUTSIDE_FOV_DEG) * LOOK_SENSITIVITY;
      yaw -= dx * scale;
      pitch = clampPitch(pitch - dy * scale);
      applyLook();
    },
    updateFrame(state: RenderFrameState): void {
      starfield.update(camera.position);
      for (const id of VISIBLE_BODIES) {
        const placement = computeBodyPlacement(ephemeris, id, state.shipPosition, state.time);
        const existing = bodyObjects.get(id);
        const obj = updateBodyObject(existing, id, placement);
        if (obj !== existing) {
          if (existing) scene.remove(existing);
          scene.add(obj);
          bodyObjects.set(id, obj);
        }
      }
    },
    render(): void {
      renderer?.render(scene, camera);
    },
    dispose(): void {
      renderer?.dispose();
    },
  };
}

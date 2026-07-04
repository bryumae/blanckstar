// Three.js scene/camera bootstrap (mvp0_spec.md §7.1). Thin glue only — math
// like the spacecraft-centered floating-origin transform (§4.6) belongs in
// src/core/, not here.
import * as THREE from 'three';

export interface Scene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
}

export function createScene(canvas: HTMLCanvasElement): Scene {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 1e12);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  return { scene, camera, renderer };
}

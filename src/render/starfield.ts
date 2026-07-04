// TODO(mvp0_spec.md §7.1): real bright-star catalog rendered as fixed points on
// the sky (no parallax from ship motion). Not implemented yet — scaffolding
// only.
import * as THREE from 'three';

export function createStarfield(): THREE.Points {
  return new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
}

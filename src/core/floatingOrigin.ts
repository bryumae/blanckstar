// Spacecraft-centered floating-origin render transform (mvp0_spec.md §4.6).
// Physics state stays in absolute double-precision heliocentric meters; render
// positions are the body offset from the ship, scaled down for Three.js:
//
//   render_pos = (body_pos - ship_pos) * scale
//
// This keeps rendered coordinates small and near the origin regardless of the
// ship's absolute heliocentric distance, avoiding float32 precision loss in the
// GPU pipeline. Never feed raw heliocentric meters into Three.js transforms.
import type { Vector3 } from './vector3';

export function renderPosition(bodyPos: Vector3, shipPos: Vector3, scale: number): Vector3 {
  return {
    x: (bodyPos.x - shipPos.x) * scale,
    y: (bodyPos.y - shipPos.y) * scale,
    z: (bodyPos.z - shipPos.z) * scale,
  };
}

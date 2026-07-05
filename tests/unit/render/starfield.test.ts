import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createStarfield, patchStarSizeShader, STAR_FIELD_RADIUS } from '../../../src/render/starfield';
import type { StarCatalogEntry } from '../../../src/net/loadEphemeris';

const CATALOG: StarCatalogEntry[] = [
  { name: 'Alpha', ra: 0, dec: 0, mag: -1.0 },
  { name: 'Beta', ra: 1, dec: 0.5, mag: 4.0 },
];

describe('patchStarSizeShader', () => {
  it('rewrites the fixed gl_PointSize to read the per-vertex aSize attribute', () => {
    const shader = { vertexShader: 'void main() {\n  gl_PointSize = size;\n}' };
    const patched = patchStarSizeShader(shader);
    expect(patched).toBe(true);
    expect(shader.vertexShader).toContain('attribute float aSize;');
    expect(shader.vertexShader).toContain('gl_PointSize = aSize;');
    expect(shader.vertexShader).not.toContain('gl_PointSize = size;');
  });

  it('reports false (no-op) when the expected injection point is absent', () => {
    const shader = { vertexShader: 'void main() {}' };
    expect(patchStarSizeShader(shader)).toBe(false);
    expect(shader.vertexShader).toBe('void main() {}');
  });
});

describe('createStarfield', () => {
  it('places stars on the fixed-radius sphere and exposes the aSize attribute + shader hook', () => {
    const field = createStarfield(CATALOG);
    const geom = field.points.geometry as THREE.BufferGeometry;
    // Per-vertex size attribute is present (named aSize, matching the shader patch).
    const aSize = geom.getAttribute('aSize');
    expect(aSize.count).toBe(CATALOG.length);
    // Brighter (lower-magnitude) star maps to a larger point size.
    expect(aSize.getX(0)).toBeGreaterThan(aSize.getX(1));
    // Positions live on the fixed radius.
    const pos = geom.getAttribute('position');
    const r = Math.hypot(pos.getX(0), pos.getY(0), pos.getZ(0));
    expect(r).toBeCloseTo(STAR_FIELD_RADIUS, 3);
    // The material carries the size-shader hook.
    const material = field.points.material as THREE.PointsMaterial;
    expect(typeof material.onBeforeCompile).toBe('function');
    // Invoking the hook applies the patch (exercises the wiring, no WebGL needed).
    const shader = { vertexShader: 'gl_PointSize = size;' };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('gl_PointSize = aSize;');
  });

  it('recenters the point cloud on the camera each update (no parallax)', () => {
    const field = createStarfield(CATALOG);
    field.update(new THREE.Vector3(100, -50, 25));
    expect(field.points.position.x).toBe(100);
    expect(field.points.position.y).toBe(-50);
    expect(field.points.position.z).toBe(25);
  });
});

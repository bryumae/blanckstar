// Top-down ecliptic (x/y plane) map projection math for the debug map
// (mvp0_spec.md §10). Pure functions: world meters (heliocentric ecliptic
// x/y) -> canvas pixels, and back for hit-testing/zoom-around-cursor. Kept
// separate from the canvas-drawing module (map.ts) so the transform math is
// unit-testable without a canvas/DOM context.
import type { Vector3 } from '../../core/vector3';

export type ScaleMode = 'linear' | 'log';

export interface MapView {
  readonly centerX: number; // world meters, map center x (ecliptic)
  readonly centerY: number; // world meters, map center y (ecliptic)
  readonly metersPerPixel: number; // world meters per canvas pixel at the current zoom
  readonly scaleMode: ScaleMode;
}

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

// Zoom presets (§10): inner system (out to ~Mars orbit) and Earth vicinity
// (a few Earth SOI radii). `metersPerPixel` assumes a canvas roughly 600px
// wide/tall; mount code may rescale by canvas size.
export const ZOOM_INNER_SYSTEM_M_PER_PX = 8e8;
export const ZOOM_EARTH_VICINITY_M_PER_PX = 6e6;

// log(1+x)-style compression of a world offset onto pixel space so both
// close-in and far-out bodies stay visible at once. Sign-preserving.
// `linear` scale mode skips the compression and is a plain divide.
function compress(worldOffset: number, metersPerPixel: number, mode: ScaleMode): number {
  if (mode === 'linear') {
    return worldOffset / metersPerPixel;
  }
  const sign = Math.sign(worldOffset);
  const mag = Math.abs(worldOffset);
  // log1p keeps the origin smooth (compress(0) === 0) and reduces to
  // approximately linear behavior for small offsets relative to metersPerPixel.
  return sign * Math.log1p(mag / metersPerPixel) * metersPerPixel_LOG_SCALE_PX;
}

// Pixels per e-fold in log mode; chosen so typical inner-system distances
// spread across a few hundred px at the default zoom presets.
const metersPerPixel_LOG_SCALE_PX = 40;

function expand(pixelOffset: number, metersPerPixel: number, mode: ScaleMode): number {
  if (mode === 'linear') {
    return pixelOffset * metersPerPixel;
  }
  const sign = Math.sign(pixelOffset);
  const mag = Math.abs(pixelOffset);
  return sign * (Math.expm1(mag / metersPerPixel_LOG_SCALE_PX) * metersPerPixel);
}

// World (ecliptic x/y, meters) -> canvas pixel (origin top-left, y flipped so
// +y world is "up" on screen).
export function worldToCanvas(world: Pick<Vector3, 'x' | 'y'>, view: MapView, canvas: CanvasSize): { x: number; y: number } {
  const dx = compress(world.x - view.centerX, view.metersPerPixel, view.scaleMode);
  const dy = compress(world.y - view.centerY, view.metersPerPixel, view.scaleMode);
  return {
    x: canvas.width / 2 + dx,
    y: canvas.height / 2 - dy,
  };
}

// Canvas pixel -> world (ecliptic x/y, meters). Inverse of worldToCanvas.
export function canvasToWorld(pixel: { x: number; y: number }, view: MapView, canvas: CanvasSize): { x: number; y: number } {
  const dx = pixel.x - canvas.width / 2;
  const dy = canvas.height / 2 - pixel.y;
  return {
    x: view.centerX + expand(dx, view.metersPerPixel, view.scaleMode),
    y: view.centerY + expand(dy, view.metersPerPixel, view.scaleMode),
  };
}

// Zoom by a multiplicative factor (>1 zooms out, <1 zooms in), clamped to a
// sane range so the map can't invert or fly to infinity.
const MIN_METERS_PER_PIXEL = 1e4;
const MAX_METERS_PER_PIXEL = 5e10;

export function zoomView(view: MapView, factor: number): MapView {
  const next = view.metersPerPixel * factor;
  return { ...view, metersPerPixel: clamp(next, MIN_METERS_PER_PIXEL, MAX_METERS_PER_PIXEL) };
}

export function panView(view: MapView, dxMeters: number, dyMeters: number): MapView {
  return { ...view, centerX: view.centerX + dxMeters, centerY: view.centerY + dyMeters };
}

export function centerOn(view: MapView, world: Pick<Vector3, 'x' | 'y'>): MapView {
  return { ...view, centerX: world.x, centerY: world.y };
}

export function withScaleMode(view: MapView, mode: ScaleMode): MapView {
  return { ...view, scaleMode: mode };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

export function innerSystemView(scaleMode: ScaleMode = 'log'): MapView {
  return { centerX: 0, centerY: 0, metersPerPixel: ZOOM_INNER_SYSTEM_M_PER_PX, scaleMode };
}

export function earthVicinityView(earthX: number, earthY: number, scaleMode: ScaleMode = 'linear'): MapView {
  return { centerX: earthX, centerY: earthY, metersPerPixel: ZOOM_EARTH_VICINITY_M_PER_PX, scaleMode };
}

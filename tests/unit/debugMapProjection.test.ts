import { describe, expect, it } from 'vitest';
import {
  canvasToWorld,
  centerOn,
  earthVicinityView,
  innerSystemView,
  panView,
  withScaleMode,
  worldToCanvas,
  zoomView,
  type MapView,
} from '../../src/ui/debug/mapProjection';

const canvas = { width: 600, height: 400 };

describe('worldToCanvas / canvasToWorld (§10 map)', () => {
  it('linear mode: the view center maps to the canvas center', () => {
    const view: MapView = { centerX: 1000, centerY: -500, metersPerPixel: 10, scaleMode: 'linear' };
    const p = worldToCanvas({ x: 1000, y: -500 }, view, canvas);
    expect(p.x).toBeCloseTo(300, 9);
    expect(p.y).toBeCloseTo(200, 9);
  });

  it('linear mode: +y world is up on screen (canvas y decreases)', () => {
    const view: MapView = { centerX: 0, centerY: 0, metersPerPixel: 10, scaleMode: 'linear' };
    const p = worldToCanvas({ x: 0, y: 100 }, view, canvas);
    expect(p.y).toBeLessThan(canvas.height / 2);
  });

  it('linear mode: worldToCanvas and canvasToWorld round-trip', () => {
    const view: MapView = { centerX: 5e8, centerY: -2e8, metersPerPixel: 1e6, scaleMode: 'linear' };
    const world = { x: 1.2e9, y: -3e8 };
    const px = worldToCanvas(world, view, canvas);
    const back = canvasToWorld(px, view, canvas);
    expect(back.x).toBeCloseTo(world.x, 3);
    expect(back.y).toBeCloseTo(world.y, 3);
  });

  it('log mode: origin still maps to canvas center', () => {
    const view: MapView = { centerX: 0, centerY: 0, metersPerPixel: 1e6, scaleMode: 'log' };
    const p = worldToCanvas({ x: 0, y: 0 }, view, canvas);
    expect(p.x).toBeCloseTo(canvas.width / 2, 9);
    expect(p.y).toBeCloseTo(canvas.height / 2, 9);
  });

  it('log mode: worldToCanvas and canvasToWorld round-trip', () => {
    const view: MapView = { centerX: 0, centerY: 0, metersPerPixel: 1e6, scaleMode: 'log' };
    const world = { x: 3e9, y: -7e8 };
    const px = worldToCanvas(world, view, canvas);
    const back = canvasToWorld(px, view, canvas);
    expect(back.x).toBeCloseTo(world.x, 0);
    expect(back.y).toBeCloseTo(world.y, 0);
  });

  it('log mode compresses far distances relative to linear mode', () => {
    const viewLog: MapView = { centerX: 0, centerY: 0, metersPerPixel: 1e6, scaleMode: 'log' };
    const viewLinear: MapView = { ...viewLog, scaleMode: 'linear' };
    const far = { x: 1e12, y: 0 };
    const pxLog = worldToCanvas(far, viewLog, canvas);
    const pxLinear = worldToCanvas(far, viewLinear, canvas);
    expect(Math.abs(pxLog.x - canvas.width / 2)).toBeLessThan(Math.abs(pxLinear.x - canvas.width / 2));
  });
});

describe('zoomView / panView / centerOn / withScaleMode', () => {
  it('zoomView multiplies metersPerPixel and clamps to sane bounds', () => {
    const view = innerSystemView('linear');
    const zoomedOut = zoomView(view, 2);
    expect(zoomedOut.metersPerPixel).toBeCloseTo(view.metersPerPixel * 2, 6);
    const zoomedInHuge = zoomView(view, 1e-30);
    expect(zoomedInHuge.metersPerPixel).toBeGreaterThan(0);
    const zoomedOutHuge = zoomView(view, 1e30);
    expect(Number.isFinite(zoomedOutHuge.metersPerPixel)).toBe(true);
  });

  it('panView shifts the center by the given meters', () => {
    const view = innerSystemView('linear');
    const panned = panView(view, 100, -50);
    expect(panned.centerX).toBeCloseTo(view.centerX + 100, 9);
    expect(panned.centerY).toBeCloseTo(view.centerY - 50, 9);
  });

  it('centerOn sets the view center to a world point', () => {
    const view = innerSystemView('linear');
    const centered = centerOn(view, { x: 42, y: -7 });
    expect(centered.centerX).toBe(42);
    expect(centered.centerY).toBe(-7);
  });

  it('withScaleMode swaps the scale mode only', () => {
    const view = innerSystemView('linear');
    const logView = withScaleMode(view, 'log');
    expect(logView.scaleMode).toBe('log');
    expect(logView.centerX).toBe(view.centerX);
  });
});

describe('zoom presets', () => {
  it('innerSystemView defaults to log scale, centered at the origin', () => {
    const view = innerSystemView();
    expect(view.scaleMode).toBe('log');
    expect(view.centerX).toBe(0);
    expect(view.centerY).toBe(0);
  });

  it('earthVicinityView centers on the given Earth position, defaults to linear', () => {
    const view = earthVicinityView(1e11, -2e10);
    expect(view.scaleMode).toBe('linear');
    expect(view.centerX).toBe(1e11);
    expect(view.centerY).toBe(-2e10);
  });
});

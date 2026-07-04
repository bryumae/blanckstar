// Canvas drawing for the debug solar-system map (mvp0_spec.md §10). Canvas is
// explicitly allowed here — the DOM-not-canvas rule (repo CLAUDE.md rule 5)
// only governs the three normal game screens; debug mode is a test harness.
// This module is thin glue over mapProjection.ts's pure transform math; it has
// no unit tests of its own (canvas pixel output isn't meaningfully asserted),
// but every coordinate it draws comes from the tested worldToCanvas().
import type { Vector3 } from '../../core/vector3';
import type { BodyId } from '../../core/ephemerisTypes';
import { worldToCanvas, type CanvasSize, type MapView } from './mapProjection';
import type { TrajectoryTrace } from './trace';

const BODY_COLORS: Record<BodyId, string> = {
  sun: '#ffd15a',
  earth: '#4cc9e0',
  moon: '#94a1b3',
  mars: '#e0655f',
  venus: '#e0b455',
  jupiter: '#e0654a',
};

const BODY_RADII_PX: Record<BodyId, number> = {
  sun: 8,
  earth: 5,
  moon: 3,
  mars: 3.5,
  venus: 4,
  jupiter: 6,
};

export interface MapDrawInput {
  readonly bodies: Readonly<Record<BodyId, Vector3>>;
  readonly shipPosition: Vector3;
  readonly shipForward: Vector3;
  readonly gravityAccel?: Vector3 | null; // scaled arrow, optional
  readonly thrustAccel?: Vector3 | null; // scaled arrow, optional
  readonly trace: TrajectoryTrace;
}

export function drawMap(ctx: CanvasRenderingContext2D, canvas: CanvasSize, view: MapView, input: MapDrawInput): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#05070b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawTrace(ctx, view, canvas, input.trace);

  for (const [id, pos] of Object.entries(input.bodies) as [BodyId, Vector3][]) {
    const p = worldToCanvas(pos, view, canvas);
    ctx.fillStyle = BODY_COLORS[id];
    ctx.beginPath();
    ctx.arc(p.x, p.y, BODY_RADII_PX[id], 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5d6b7d';
    ctx.font = '10px monospace';
    ctx.fillText(id, p.x + BODY_RADII_PX[id] + 3, p.y + 3);
  }

  const shipPx = worldToCanvas(input.shipPosition, view, canvas);
  drawShip(ctx, shipPx, input.shipForward);

  if (input.gravityAccel) {
    drawVectorArrow(ctx, shipPx, input.gravityAccel, view, canvas, '#57c98a', 'g');
  }
  if (input.thrustAccel) {
    drawVectorArrow(ctx, shipPx, input.thrustAccel, view, canvas, '#e0b455', 'thrust');
  }
}

function drawTrace(ctx: CanvasRenderingContext2D, view: MapView, canvas: CanvasSize, trace: TrajectoryTrace): void {
  const points = trace.points();
  if (points.length < 2) return;
  ctx.strokeStyle = 'rgba(76, 201, 224, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  points.forEach((p, i) => {
    const px = worldToCanvas(p, view, canvas);
    if (i === 0) ctx.moveTo(px.x, px.y);
    else ctx.lineTo(px.x, px.y);
  });
  ctx.stroke();
}

function drawShip(ctx: CanvasRenderingContext2D, shipPx: { x: number; y: number }, forward: Vector3): void {
  const angle = Math.atan2(-forward.y, forward.x); // screen y is flipped
  ctx.save();
  ctx.translate(shipPx.x, shipPx.y);
  ctx.rotate(angle);
  ctx.fillStyle = '#e2e8f1';
  ctx.beginPath();
  ctx.moveTo(9, 0);
  ctx.lineTo(-6, 5);
  ctx.lineTo(-6, -5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Draws a scaled, labeled arrow from the ship position in the direction of a
// world-space acceleration vector. The vector's world-space projection onto
// the ecliptic plane is transformed the same way positions are, so the arrow
// direction is correct under both linear and log scale modes; the length is
// a fixed screen-space scale (not physically to-scale, just legible).
function drawVectorArrow(
  ctx: CanvasRenderingContext2D,
  originPx: { x: number; y: number },
  accel: Vector3,
  view: MapView,
  canvas: CanvasSize,
  color: string,
  label: string,
): void {
  const mag = Math.hypot(accel.x, accel.y);
  if (mag === 0) return;
  const dirX = accel.x / mag;
  const dirY = accel.y / mag;
  const arrowLenPx = 40;
  // Project a point one "unit direction" away in world space, then measure the
  // resulting pixel delta, so log-scale distortion near the ship is consistent
  // with how positions are drawn.
  const probeWorld = { x: view.centerX + dirX * view.metersPerPixel, y: view.centerY + dirY * view.metersPerPixel };
  const probeCenterPx = worldToCanvas({ x: view.centerX, y: view.centerY }, view, canvas);
  const probePx = worldToCanvas(probeWorld, view, canvas);
  const ux = probePx.x - probeCenterPx.x || dirX;
  const uy = probePx.y - probeCenterPx.y || -dirY;
  const uLen = Math.hypot(ux, uy) || 1;
  const endX = originPx.x + (ux / uLen) * arrowLenPx;
  const endY = originPx.y + (uy / uLen) * arrowLenPx;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(originPx.x, originPx.y);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.font = '9px monospace';
  ctx.fillText(label, endX + 4, endY);
}

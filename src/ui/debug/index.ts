// Debug mode entry point (mvp0_spec.md §10): the dev-only test harness. True
// state readout, Earth-relative energy panel, solar-system map with
// trajectory trace, gravity/thrust vectors, teleport, and integrator
// diagnostics. Gated by isDebugEnabled() (gate.ts); the orchestrator must load
// this module behind a dynamic `import()` at the call site so it code-splits
// out of normal builds entirely (see the repo-root report for the exact
// main.ts wiring).
//
// This module never constructs a Worker itself — it only talks to the sim
// through the injected `deps.subscribe`/`deps.send` seam, mirroring every
// other side-effect boundary in this codebase (ADR-0001, src/net/*).
import type { BodyId } from '../../core/ephemerisTypes';
import type { Vector3 } from '../../core/vector3';
import { gravityAcceleration } from '../../core/gravity';
import { MAX_ACCELERATION } from '../../core/constants';
import { mul } from '../../core/vector3';
import type { SimCommand, SimEvent, StateEvent } from '../../sim/messages';
import { computeEarthRelativeState } from './earthRelative';
import { TrajectoryTrace } from './trace';
import {
  canvasToWorld,
  earthVicinityView,
  innerSystemView,
  panView,
  worldToCanvas,
  zoomView,
  type MapView,
} from './mapProjection';
import { drawMap } from './map';
import {
  formatMagnitudeKm,
  formatMagnitudeKmPerSec,
  formatMissionElapsed,
  formatSimTimeUtc,
  formatVectorKm,
  formatVectorKmPerSec,
  formatVectorRawMeters,
  formatVectorUnit,
} from './format';
import './debug.css';

export { isDebugEnabled } from './gate';

export interface DebugOverlayDeps {
  /** Subscribe to sim events; returns an unsubscribe function. */
  readonly subscribe: (cb: (event: SimEvent) => void) => () => void;
  /** Send a command to the sim. */
  readonly send: (cmd: SimCommand) => void;
}

export interface DebugOverlayHandle {
  destroy(): void;
}

const TRACE_CAPACITY = 2000;

export function mountDebugOverlay(root: HTMLElement, deps: DebugOverlayDeps): DebugOverlayHandle {
  // window-level listeners outlive this mount unless torn down explicitly;
  // one signal lets destroy() remove all of them in one call (#16).
  const windowListeners = new AbortController();

  const watermark = document.createElement('div');
  watermark.className = 'debug-watermark';
  watermark.textContent = 'DEBUG';

  const panel = document.createElement('div');
  panel.className = 'debug-overlay';

  const badge = document.createElement('div');
  badge.className = 'debug-badge';
  badge.textContent = 'DEBUG MODE';
  panel.appendChild(badge);

  // ---- true state section ----
  const trueStateSection = section('TRUE STATE');
  const rowSimTime = addRow(trueStateSection, 'Sim time (UTC)');
  const rowElapsed = addRow(trueStateSection, 'Mission elapsed');
  const rowWarp = addRow(trueStateSection, 'Warp');
  const rowDt = addRow(trueStateSection, 'dt tier');
  const rowPosKm = addRow(trueStateSection, 'Position');
  const rowPosM = addRow(trueStateSection, 'Position (raw m)');
  const rowVelKm = addRow(trueStateSection, 'Velocity');
  const rowVelM = addRow(trueStateSection, 'Velocity (raw m)');
  const rowForward = addRow(trueStateSection, 'Forward');
  const rowDeltaV = addRow(trueStateSection, 'Cumulative Δv');

  // ---- Earth-relative section ----
  const earthSection = section('EARTH-RELATIVE');
  const rowEarthPos = addRow(earthSection, 'Position');
  const rowEarthVel = addRow(earthSection, 'Speed');
  const rowEarthEnergy = addRow(earthSection, 'Specific energy (v²/2 − μ/r)');
  const rowEarthSOI = addRow(earthSection, 'Distance vs R_SOI_EARTH');
  const rowEarthAlt = addRow(earthSection, 'Altitude above surface');

  // ---- integrator diagnostics ----
  const diagSection = section('INTEGRATOR DIAGNOSTICS');
  const rowLastDt = addRow(diagSection, 'Last dt');
  const rowSubsteps = addRow(diagSection, 'Substeps last tick');
  const rowTotalSteps = addRow(diagSection, 'Total steps');

  // ---- map ----
  const mapSection = section('SOLAR SYSTEM MAP');
  const mapControls = document.createElement('div');
  mapControls.className = 'debug-map-controls';
  const btnInner = mapButton('INNER SYSTEM');
  const btnEarth = mapButton('EARTH VICINITY');
  const btnScale = mapButton('LOG');
  mapControls.append(btnInner, btnEarth, btnScale);
  mapSection.appendChild(mapControls);

  const canvas = document.createElement('canvas');
  canvas.className = 'debug-map-canvas';
  mapSection.appendChild(canvas);

  // ---- teleport ----
  const teleportSection = section('TELEPORT (DEBUG-ONLY)');
  const form = document.createElement('div');
  form.className = 'debug-teleport-form';
  const posX = teleportInput('pos.x km', form);
  const posY = teleportInput('pos.y km', form);
  const posZ = teleportInput('pos.z km', form);
  const velX = teleportInput('vel.x km/s', form);
  const velY = teleportInput('vel.y km/s', form);
  const velZ = teleportInput('vel.z km/s', form);
  teleportSection.appendChild(form);
  const teleportBtn = document.createElement('button');
  teleportBtn.className = 'debug-teleport-submit';
  teleportBtn.textContent = 'TELEPORT SHIP';
  teleportSection.appendChild(teleportBtn);

  panel.append(trueStateSection, earthSection, diagSection, mapSection, teleportSection);
  root.append(watermark, panel);

  // ---- state ----
  const trace = new TrajectoryTrace(TRACE_CAPACITY);
  let mapView: MapView = innerSystemView();
  let latest: StateEvent | null = null;
  let earthVelocity: Vector3 | null = null;
  let pendingEarthVelQuery = false;
  let earthVelSimTime: number | null = null; // simTime the current Earth velocity is for
  const DEBUG_EPHEMERIS_REQUEST_ID = -1; // negative: distinguishable from app-issued request ids

  function ctx2d(): CanvasRenderingContext2D | null {
    return canvas.getContext('2d');
  }

  function resizeCanvas(): void {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width));
    canvas.height = Math.max(1, Math.floor(rect.height));
    redrawMap();
  }
  const resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(canvas);

  function redrawMap(): void {
    const context = ctx2d();
    if (!context || !latest) return;
    drawMap(context, { width: canvas.width, height: canvas.height }, mapView, {
      bodies: latest.bodies,
      shipPosition: latest.ship.position,
      shipForward: latest.ship.forward,
      gravityAccel: gravityAccelFor(latest),
      thrustAccel: thrustAccelFor(latest),
      trace,
    });
  }

  function gravityAccelFor(state: StateEvent): Vector3 {
    return gravityAcceleration(state.ship.position, {
      sun: state.bodies.sun,
      earth: state.bodies.earth,
      moon: state.bodies.moon,
    });
  }

  function thrustAccelFor(state: StateEvent): Vector3 | null {
    if (!state.ship.burning) return null;
    return mul(state.ship.forward, MAX_ACCELERATION);
  }

  function render(state: StateEvent): void {
    latest = state;
    trace.push(state.ship.position);

    rowSimTime.value.textContent = formatSimTimeUtc(state.simTime);
    rowElapsed.value.textContent = formatMissionElapsed(state.missionElapsed);
    rowWarp.value.textContent = state.warp === 0 ? 'PAUSED' : `${state.warp}×`;
    rowDt.value.textContent = state.debug ? `${state.debug.lastDt.toFixed(1)} s` : '—';
    rowPosKm.value.textContent = formatVectorKm(state.ship.position);
    rowPosM.value.textContent = formatVectorRawMeters(state.ship.position);
    rowVelKm.value.textContent = formatVectorKmPerSec(state.ship.velocity);
    rowVelM.value.textContent = formatVectorRawMeters(state.ship.velocity);
    rowForward.value.textContent = formatVectorUnit(state.ship.forward);
    rowDeltaV.value.textContent = `${(state.ship.deltaVSpent / 1000).toFixed(4)} km/s`;

    if (state.debug) {
      rowLastDt.value.textContent = `${state.debug.lastDt.toFixed(2)} s`;
      rowSubsteps.value.textContent = String(state.debug.substepsLastTick);
      rowTotalSteps.value.textContent = String(state.debug.totalSteps);
    }

    updateEarthRelative(state);

    // Fetch Earth's velocity for this frame via the existing ephemeris query
    // command (§7.4) rather than duplicating Hermite interpolation here; the sim
    // already owns that math. Guard on the frame's simTime (not just the pending
    // flag) so we don't re-query the same instant — otherwise, while paused, the
    // result handler would re-trigger a query in an endless ping-pong.
    if (state.simTime !== earthVelSimTime && !pendingEarthVelQuery) {
      pendingEarthVelQuery = true;
      earthVelSimTime = state.simTime;
      deps.send({ type: 'ephemerisQuery', requestId: DEBUG_EPHEMERIS_REQUEST_ID, body: 'earth', t: state.simTime });
    }

    redrawMap();
  }

  // Refresh only the Earth-relative panel from the latest state + Earth velocity.
  // Called on each state frame and once Earth's velocity arrives — the latter
  // must NOT re-run render() (which pushes the trace and re-queries), or a paused
  // sim would loop forever re-drawing the same frame.
  function updateEarthRelative(state: StateEvent): void {
    if (!earthVelocity) return;
    const rel = computeEarthRelativeState(state.ship.position, state.ship.velocity, state.bodies.earth, earthVelocity);
    rowEarthPos.value.textContent = formatMagnitudeKm(rel.positionRel);
    rowEarthVel.value.textContent = formatMagnitudeKmPerSec(rel.velocityRel);
    rowEarthEnergy.value.textContent = `${rel.specificEnergy.toFixed(2)} J/kg`;
    rowEarthEnergy.value.classList.toggle('is-bound', rel.bound);
    rowEarthEnergy.value.classList.toggle('is-unbound', !rel.bound);
    rowEarthSOI.value.textContent = rel.insideSOI ? 'INSIDE SOI' : 'outside SOI';
    rowEarthSOI.value.classList.toggle('is-bound', rel.insideSOI);
    rowEarthAlt.value.textContent = `${(rel.altitude / 1000).toFixed(1)} km`;
  }

  const unsubscribe = deps.subscribe((event) => {
    if (event.type === 'state') {
      render(event);
    } else if (event.type === 'ephemerisResult' && event.requestId === DEBUG_EPHEMERIS_REQUEST_ID) {
      earthVelocity = event.velocity;
      pendingEarthVelQuery = false;
      // Light refresh only — do not call render() (see updateEarthRelative).
      if (latest) {
        updateEarthRelative(latest);
        redrawMap();
      }
    }
  });

  // ---- map interaction ----
  btnInner.addEventListener('click', () => {
    mapView = innerSystemView(mapView.scaleMode);
    setActive(btnInner, btnEarth);
    redrawMap();
  });
  btnEarth.addEventListener('click', () => {
    const earthPos = latest?.bodies.earth ?? { x: 0, y: 0, z: 0 };
    mapView = earthVicinityView(earthPos.x, earthPos.y, mapView.scaleMode);
    setActive(btnEarth, btnInner);
    redrawMap();
  });
  btnScale.addEventListener('click', () => {
    mapView = { ...mapView, scaleMode: mapView.scaleMode === 'log' ? 'linear' : 'log' };
    btnScale.textContent = mapView.scaleMode.toUpperCase();
    redrawMap();
  });
  setActive(btnInner, btnEarth);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    mapView = zoomView(mapView, e.deltaY > 0 ? 1.15 : 1 / 1.15);
    redrawMap();
  });

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener(
    'mousemove',
    (e) => {
      if (!dragging) return;
      const dxPx = e.clientX - lastX;
      const dyPx = e.clientY - lastY;
      const worldA = canvasToWorld({ x: 0, y: 0 }, mapView, { width: canvas.width, height: canvas.height });
      const worldB = canvasToWorld({ x: dxPx, y: -dyPx }, mapView, { width: canvas.width, height: canvas.height });
      mapView = panView(mapView, -(worldB.x - worldA.x), -(worldB.y - worldA.y));
      lastX = e.clientX;
      lastY = e.clientY;
      redrawMap();
    },
    { signal: windowListeners.signal },
  );
  window.addEventListener(
    'mouseup',
    () => {
      dragging = false;
    },
    { signal: windowListeners.signal },
  );

  // Keep worldToCanvas import used for consumers that only need the pure
  // transform for hit-testing (e.g. a future click-to-select body); referenced
  // here so this module documents the read path even though the current UI
  // doesn't yet need canvas->body picking.
  void worldToCanvas;

  // ---- teleport ----
  teleportBtn.addEventListener('click', () => {
    const position = {
      x: kmToM(posX),
      y: kmToM(posY),
      z: kmToM(posZ),
    };
    const velocity = {
      x: kmToM(velX),
      y: kmToM(velY),
      z: kmToM(velZ),
    };
    deps.send({ type: 'debugTeleport', position, velocity });
  });

  resizeCanvas();

  return {
    destroy(): void {
      windowListeners.abort();
      unsubscribe();
      resizeObserver.disconnect();
      root.removeChild(watermark);
      root.removeChild(panel);
    },
  };
}

function kmToM(input: HTMLInputElement): number {
  const v = Number(input.value);
  return Number.isFinite(v) ? v * 1000 : 0;
}

function section(title: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'debug-section';
  const heading = document.createElement('div');
  heading.className = 'debug-section-title';
  heading.textContent = title;
  el.appendChild(heading);
  return el;
}

function addRow(parent: HTMLElement, label: string): { row: HTMLDivElement; value: HTMLSpanElement } {
  const row = document.createElement('div');
  row.className = 'debug-row';
  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'value';
  v.textContent = '—';
  row.append(l, v);
  parent.appendChild(row);
  return { row, value: v };
}

function mapButton(label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  return btn;
}

function teleportInput(placeholder: string, parent: HTMLElement): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.placeholder = placeholder;
  input.step = 'any';
  parent.appendChild(input);
  return input;
}

function setActive(active: HTMLButtonElement, ...others: HTMLButtonElement[]): void {
  active.classList.add('is-active');
  for (const o of others) o.classList.remove('is-active');
}

// Re-export types some tests / the map module reference by BodyId for clarity.
export type { BodyId };

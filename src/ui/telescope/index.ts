// Telescope screen (mvp0_spec.md §7.1): outside view + telescope mode,
// click-to-identify, angular separation measurement. Plain DOM/CSS (repo rule
// 5) driving a single Three.js viewport (src/render/scene.ts).
import type { EphemerisData } from '../../core/ephemerisTypes';
import type { StarCatalogEntry } from '../../net/loadEphemeris';
import { createTelescopeViewport, type TelescopeViewport, type ViewMode } from '../../render/scene';
import {
  candidateToIdentified,
  pickNearest,
  pickToleranceRadians,
  screenPointToRayDirection,
  type PickCandidate,
} from '../../render/picking';
import { raDecToUnit } from '../../render/astro';
import { VISIBLE_BODIES, computeBodyPlacement } from '../../render/bodies';
import type { RenderFrameState, TelescopeInstruments } from '../../render/types';
import {
  addIdentified,
  canMeasureSeparation,
  createInitialState,
  removeIdentified,
  setSepSelection,
  withFov,
  withMode,
  withSeparationLogged,
  withSeparationResult,
  type TelescopeUiState,
} from './state';
import './telescope.css';

export interface TelescopeScreenDeps {
  readonly ephemeris: EphemerisData;
  readonly starCatalog: readonly StarCatalogEntry[];
  readonly instruments: TelescopeInstruments;
  /** Returns the current frame state on demand (polled once per render tick). */
  readonly getFrameState: () => RenderFrameState;
}

export interface TelescopeScreenHandle {
  /** Call from the host render loop; renders one frame and re-derives body/star picking data. */
  renderFrame(): void;
  /** Clear identified objects and the separation-tool selection — call when a
   * new scenario starts, so a fresh run doesn't inherit the previous run's
   * identified-objects list. */
  reset(): void;
  destroy(): void;
}

function bodyDisplayName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export function mountTelescopeScreen(root: HTMLElement, deps: TelescopeScreenDeps): TelescopeScreenHandle {
  root.textContent = '';
  root.classList.add('telescope-screen');

  const viewportEl = document.createElement('div');
  viewportEl.className = 'telescope-viewport';

  const canvas = document.createElement('canvas');
  canvas.className = 'telescope-canvas';
  viewportEl.appendChild(canvas);

  const modeToggle = document.createElement('div');
  modeToggle.className = 'telescope-overlay telescope-overlay--top-left';
  const toggleGroup = document.createElement('div');
  toggleGroup.className = 'telescope-mode-toggle';
  const outsideBtn = document.createElement('button');
  outsideBtn.textContent = 'OUTSIDE VIEW';
  const teleBtn = document.createElement('button');
  teleBtn.textContent = 'TELESCOPE';
  toggleGroup.append(outsideBtn, teleBtn);
  modeToggle.appendChild(toggleGroup);
  viewportEl.appendChild(modeToggle);

  const fovOverlay = document.createElement('div');
  fovOverlay.className = 'telescope-overlay telescope-overlay--top-right';
  const fovLabelEl = document.createElement('div');
  fovLabelEl.className = 'telescope-fov-label';
  fovLabelEl.textContent = 'FIELD OF VIEW';
  const fovValueEl = document.createElement('div');
  fovValueEl.className = 'telescope-fov-value';
  fovOverlay.append(fovLabelEl, fovValueEl);
  viewportEl.appendChild(fovOverlay);

  const zoomBar = document.createElement('div');
  zoomBar.className = 'telescope-zoom-bar';
  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'label';
  zoomLabel.textContent = 'ZOOM';
  const zoomSlider = document.createElement('input');
  zoomSlider.type = 'range';
  zoomSlider.min = '0.1';
  zoomSlider.max = '45';
  zoomSlider.step = '0.1';
  const zoomValue = document.createElement('span');
  zoomValue.className = 'value';
  zoomBar.append(zoomLabel, zoomSlider, zoomValue);
  viewportEl.appendChild(zoomBar);

  const hint = document.createElement('div');
  hint.className = 'telescope-hint';
  hint.textContent = 'drag to look · scroll to zoom · click a body or named star to identify';
  viewportEl.appendChild(hint);

  const reticle = document.createElement('div');
  reticle.className = 'telescope-reticle';
  viewportEl.appendChild(reticle);

  const labelLayer = document.createElement('div');
  labelLayer.style.position = 'absolute';
  labelLayer.style.inset = '0';
  labelLayer.style.pointerEvents = 'none';
  viewportEl.appendChild(labelLayer);

  const sidebarToggle = document.createElement('button');
  sidebarToggle.type = 'button';
  sidebarToggle.className = 'telescope-sidebar-toggle';
  sidebarToggle.textContent = '›';
  sidebarToggle.setAttribute('aria-label', 'Toggle sidebar panel');
  viewportEl.appendChild(sidebarToggle);

  // ---- sidebar ----
  const sidebar = document.createElement('aside');
  sidebar.className = 'telescope-sidebar';

  const idSection = document.createElement('div');
  idSection.className = 'telescope-sidebar-section';
  const idTitle = document.createElement('div');
  idTitle.className = 'telescope-sidebar-title';
  idTitle.textContent = 'IDENTIFIED OBJECTS';
  const idSubtitle = document.createElement('div');
  idSubtitle.className = 'telescope-sidebar-subtitle';
  idSection.append(idTitle, idSubtitle);

  const idList = document.createElement('div');
  idList.className = 'telescope-id-list';

  const sepSection = document.createElement('div');
  sepSection.className = 'telescope-sidebar-section';
  const sepTitle = document.createElement('div');
  sepTitle.className = 'telescope-sidebar-title';
  sepTitle.textContent = 'ANGULAR SEPARATION';
  sepTitle.style.marginBottom = '11px';
  const sepRow = document.createElement('div');
  sepRow.className = 'telescope-sep-select-row';
  const sepASelect = document.createElement('select');
  const sepArrow = document.createElement('span');
  sepArrow.className = 'telescope-sep-arrow';
  sepArrow.textContent = '↔';
  const sepBSelect = document.createElement('select');
  sepRow.append(sepASelect, sepArrow, sepBSelect);

  const sepReadout = document.createElement('div');
  sepReadout.className = 'telescope-sep-readout';
  const sepReadoutLabel = document.createElement('div');
  sepReadoutLabel.className = 'telescope-sep-readout-label';
  sepReadoutLabel.textContent = 'MEASURED θ = arccos(u_A · u_B)';
  const sepReadoutValue = document.createElement('div');
  sepReadoutValue.className = 'telescope-sep-readout-value';
  sepReadoutValue.textContent = '—';
  const sepReadoutRad = document.createElement('div');
  sepReadoutRad.className = 'telescope-sep-readout-rad';
  sepReadout.append(sepReadoutLabel, sepReadoutValue, sepReadoutRad);

  const logBtn = document.createElement('button');
  logBtn.className = 'telescope-log-btn';
  logBtn.textContent = '＋ Log measurement';

  sepSection.append(sepTitle, sepRow, sepReadout, logBtn);

  const sensorSection = document.createElement('div');
  sensorSection.className = 'telescope-sidebar-section';
  sensorSection.style.borderBottom = 'none';
  const sensorTitle = document.createElement('div');
  sensorTitle.className = 'telescope-sidebar-title';
  sensorTitle.textContent = 'VIEW SENSORS';
  sensorTitle.style.marginBottom = '10px';
  sensorSection.appendChild(sensorTitle);

  function sensorRow(label: string): { row: HTMLDivElement; value: HTMLSpanElement } {
    const row = document.createElement('div');
    row.className = 'telescope-sensor-row';
    const l = document.createElement('span');
    l.className = 'label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'value';
    row.append(l, v);
    sensorSection.appendChild(row);
    return { row, value: v };
  }
  const attitudeSensor = sensorRow('Star-tracker attitude');
  attitudeSensor.value.textContent = 'LOCKED';
  attitudeSensor.value.classList.add('is-ok');
  const sunDirSensor = sensorRow('Sun-direction (inertial)');
  const forwardSensor = sensorRow('Forward vector');

  sidebar.append(idSection, idList, sepSection, sensorSection);

  root.append(viewportEl, sidebar);

  sidebarToggle.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('is-collapsed');
    sidebarToggle.classList.toggle('is-collapsed', collapsed);
    sidebarToggle.textContent = collapsed ? '‹' : '›';
  });

  // ---- viewport + state ----
  const viewport: TelescopeViewport = createTelescopeViewport(canvas, deps.ephemeris, deps.starCatalog);
  let ui: TelescopeUiState = createInitialState();
  let latestFrame: RenderFrameState = deps.getFrameState();

  function fmtVec(v: { x: number; y: number; z: number }): string {
    return `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
  }

  function render(): void {
    outsideBtn.classList.toggle('is-active', ui.mode === 'outside');
    teleBtn.classList.toggle('is-active', ui.mode === 'telescope');
    zoomBar.style.display = ui.mode === 'telescope' ? 'flex' : 'none';
    reticle.style.display = ui.mode === 'telescope' ? 'block' : 'none';
    canvas.style.cursor = 'crosshair';

    const fovLabel = ui.mode === 'outside' ? '72.0°' : `${ui.fovDeg.toFixed(1)}°`;
    fovValueEl.textContent = fovLabel;
    zoomValue.textContent = fovLabel;
    if (Number(zoomSlider.value) !== ui.fovDeg) {
      zoomSlider.value = String(ui.fovDeg);
    }

    idSubtitle.textContent = `${ui.identified.length} of ${VISIBLE_BODIES.length + deps.starCatalog.length} catalog targets tagged`;

    idList.textContent = '';
    if (ui.identified.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'telescope-id-empty';
      empty.textContent = 'Nothing identified yet — click objects in the view.';
      idList.appendChild(empty);
    } else {
      for (const obj of ui.identified) {
        const row = document.createElement('div');
        row.className = 'telescope-id-row';
        const dot = document.createElement('span');
        dot.className = `telescope-id-dot ${obj.kind === 'star' ? 'is-star' : 'is-body'}`;
        dot.style.background = obj.kind === 'star' ? '#e2e8f1' : '#4cc9e0';
        const name = document.createElement('span');
        name.className = 'telescope-id-name';
        name.textContent = obj.name ?? obj.id;
        name.title = obj.name ?? obj.id;
        const kind = document.createElement('span');
        kind.className = 'telescope-id-kind';
        kind.textContent = obj.kind === 'star' ? 'STAR' : 'BODY';
        const removeBtn = document.createElement('button');
        removeBtn.className = 'telescope-id-remove';
        removeBtn.type = 'button';
        removeBtn.textContent = '✕';
        removeBtn.setAttribute('aria-label', `Remove ${obj.name ?? obj.id}`);
        removeBtn.addEventListener('click', () => {
          ui = removeIdentified(ui, obj.id);
          render();
        });
        row.append(dot, name, kind, removeBtn);
        idList.appendChild(row);
      }
    }

    const options = ui.identified;
    for (const [select, current] of [
      [sepASelect, ui.sepA],
      [sepBSelect, ui.sepB],
    ] as const) {
      const prevValue = select.value;
      select.textContent = '';
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = select === sepASelect ? '— body A —' : '— body B —';
      select.appendChild(blank);
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.name ?? o.id;
        select.appendChild(opt);
      }
      select.value = current ?? prevValue ?? '';
    }

    const canMeasure = canMeasureSeparation(ui);
    if (ui.lastSepRadians !== null) {
      const deg = (ui.lastSepRadians * 180) / Math.PI;
      sepReadoutValue.textContent = `${deg.toFixed(4)}°`;
      sepReadoutRad.textContent = `${ui.lastSepRadians.toFixed(6)} rad`;
    } else {
      sepReadoutValue.textContent = '—';
      sepReadoutRad.textContent = '';
    }
    logBtn.disabled = ui.lastSepRadians === null || ui.lastSepLogged;
    logBtn.classList.toggle('is-logged', ui.lastSepLogged);
    logBtn.textContent = ui.lastSepLogged ? 'Logged' : '＋ Log measurement';
    void canMeasure;

    updateSensors();
  }

  let sunDirectionCache = { x: 0, y: 0, z: 0 };

  // Sensor readouts change every frame (ship moves), but nothing else in
  // render() does — rebuilding the identified-objects list and the
  // <select> option lists on every requestAnimationFrame tick was
  // destroying/recreating a native <select>'s children out from under an
  // open dropdown popup, causing it to flicker and stall the compositor.
  // Only this cheap textContent update runs per frame; render() (which
  // rebuilds the DOM lists) runs only in response to actual state changes.
  function updateSensors(): void {
    sunDirSensor.value.textContent = fmtVec(sunDirectionCache);
    forwardSensor.value.textContent = fmtVec(latestFrame.shipForward);
  }

  outsideBtn.addEventListener('click', () => {
    viewport.setMode('outside');
    ui = withFov(withMode(ui, 'outside'), viewport.getFovDeg());
    render();
  });
  teleBtn.addEventListener('click', () => {
    viewport.setMode('telescope');
    ui = withFov(withMode(ui, 'telescope'), viewport.getFovDeg());
    render();
  });

  zoomSlider.addEventListener('input', () => {
    const next = Number(zoomSlider.value);
    viewport.setFovDeg(next);
    ui = withFov(ui, viewport.getFovDeg());
    render();
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (viewport.getMode() !== 'telescope') return;
    viewport.zoomBy(e.deltaY > 0 ? 1 : -1);
    ui = withFov(ui, viewport.getFovDeg());
    render();
  });

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    viewport.onDragMove(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
  });

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const rayDir = screenPointToRayDirection(viewport.camera, e.clientX, e.clientY, rect);
    const tolerance = pickToleranceRadians(viewport.getFovDeg(), rect.height);

    const candidates: PickCandidate[] = [];
    for (const id of VISIBLE_BODIES) {
      const placement = computeBodyPlacement(deps.ephemeris, id, latestFrame.shipPosition, latestFrame.time);
      candidates.push({ kind: 'body', id, name: bodyDisplayName(id), bodyId: id, direction: placement.direction });
    }
    deps.starCatalog.forEach((star, i) => {
      candidates.push({ kind: 'star', id: `star:${i}`, name: star.name, direction: raDecToUnit(star.ra, star.dec) });
    });

    const hit = pickNearest(rayDir, candidates, tolerance);
    if (hit) {
      ui = addIdentified(ui, candidateToIdentified(hit));
      render();
      showClickLabel(hit.name ?? hit.id, e.clientX - rect.left, e.clientY - rect.top);
    }
  });

  // Transient name label at the click point, so identifying an object gives
  // immediate feedback in the view itself rather than only in the sidebar
  // list. Fades out and is removed shortly after.
  const CLICK_LABEL_LIFETIME_MS = 1600;
  const CLICK_LABEL_FADE_MS = 600;
  function showClickLabel(text: string, x: number, y: number): void {
    const label = document.createElement('div');
    label.className = 'telescope-click-label';
    label.style.left = `${x}px`;
    label.style.top = `${y}px`;
    label.textContent = text;
    labelLayer.appendChild(label);
    setTimeout(() => label.classList.add('is-fading'), CLICK_LABEL_LIFETIME_MS - CLICK_LABEL_FADE_MS);
    setTimeout(() => label.remove(), CLICK_LABEL_LIFETIME_MS);
  }

  sepASelect.addEventListener('change', () => {
    ui = setSepSelection(ui, 'A', sepASelect.value || null);
    render();
  });
  sepBSelect.addEventListener('change', () => {
    ui = setSepSelection(ui, 'B', sepBSelect.value || null);
    render();
  });

  async function measureSeparation(): Promise<void> {
    if (!canMeasureSeparation(ui) || ui.sepA === null || ui.sepB === null) return;
    const findBodyId = (id: string): TelescopeUiState['identified'][number] | undefined =>
      ui.identified.find((o) => o.id === id);
    const a = findBodyId(ui.sepA);
    const b = findBodyId(ui.sepB);
    if (!a?.bodyId || !b?.bodyId) return; // MVP0 instrument seam only supports body-body separations
    const result = await deps.instruments.measureAngularSeparation(a.bodyId, b.bodyId);
    ui = withSeparationResult(ui, result.radians);
    render();
  }

  // Auto-measure whenever both selections are valid (mirrors the mockup's
  // live readout as soon as two bodies are picked).
  sepASelect.addEventListener('change', () => void measureSeparation());
  sepBSelect.addEventListener('change', () => void measureSeparation());

  logBtn.addEventListener('click', () => {
    if (logBtn.disabled) return;
    ui = withSeparationLogged(ui);
    render();
  });

  function resizeCanvas(): void {
    const rect = viewportEl.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width));
    canvas.height = Math.max(1, Math.floor(rect.height));
    viewport.camera.aspect = canvas.width / canvas.height;
    viewport.camera.updateProjectionMatrix();
    viewport.renderer.setSize(canvas.width, canvas.height, false);
  }
  resizeCanvas();
  const resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(viewportEl);

  render();

  return {
    renderFrame(): void {
      latestFrame = deps.getFrameState();
      viewport.updateFrame(latestFrame);
      viewport.render();
      updateSensors();
    },
    reset(): void {
      ui = createInitialState();
      render();
    },
    destroy(): void {
      resizeObserver.disconnect();
      viewport.dispose();
    },
  };
}

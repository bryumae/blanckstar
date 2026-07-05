// Data screen (mvp0_spec.md §7, §7.2-7.5, §7.8, §7 inserted-state paragraphs,
// §12 AC6/AC7): radio/Earth beacon, ship self-knowledge, scheduled burns, time
// controls, ephemeris queries, measurement log, and inserted-state analysis.
// Plain DOM/CSS (repo rule 5), 12-col card grid per docs/design/
// mission-interface-template.html's DATA section. Drives the sim worker only
// through the injected `send`/listener seam (ADR-0001) — never imports src/sim
// internals beyond the frozen message-protocol types.
import type { EphemerisData } from '../../core/ephemerisTypes';
import type { CandidateStore } from '../candidateStore';
import { card } from '../dataCard';
import type {
  BurnEndedEvent,
  BurnStartedEvent,
  EphemerisResultEvent,
  MeasurementAddedEvent,
  ScheduledBurnAddedEvent,
  ScheduledBurnCancelledEvent,
  SimCommand,
  SimEvent,
} from '../../sim/messages';
import type { RadioLockData, ScheduledBurn, ShipState } from '../../sim/types';
import {
  insertedOrbitalElements,
  runClosestApproachChunked,
  type ChunkedRunHandle,
  type InsertedState,
  type OrbitReferenceFrame,
} from './insertedStateAnalysis';
import { fmtDegrees, fmtKm, fmtKmPerS, fmtMet, fmtNumber, fmtScientific, fmtUtc, fmtVec } from './format';
import './data.css';

export interface DataScreenDeps {
  readonly ephemeris: EphemerisData;
  readonly send: (cmd: SimCommand) => void;
  readonly addSimListener: (cb: (e: SimEvent) => void) => void;
  readonly removeSimListener: (cb: (e: SimEvent) => void) => void;
  readonly candidates: CandidateStore;
}

export interface DataScreenHandle {
  destroy(): void;
}

function row(label: string, value: string, cls = ''): HTMLDivElement {
  const r = document.createElement('div');
  r.className = 'data-row';
  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = `value ${cls}`.trim();
  v.textContent = value;
  r.append(l, v);
  return r;
}

export function mountDataScreen(root: HTMLElement, deps: DataScreenDeps): DataScreenHandle {
  root.textContent = '';
  root.classList.add('data-screen');

  // Latest known state (from `state` events). Only fields the spec allows to
  // surface are ever read by the render functions below — position/velocity
  // are intentionally never touched by this screen (§5.1, §7.8).
  let ship: ShipState | null = null;
  let simTime = 0;
  let missionElapsed = 0;
  let scheduledBurns: ScheduledBurn[] = [];
  let liveBurn: { startTime: number; endTime: number; throttle: number } | null = null;
  let lastRadioLock: RadioLockData | null = null;
  let radioLockCount = 0;

  // ==================== 1. Radio / Earth beacon ====================
  const radio = card('data-card--span-4', 'RADIO · EARTH BEACON');
  const radioStatus = document.createElement('span');
  radioStatus.className = 'data-status-badge is-idle';
  radioStatus.innerHTML = '<span class="data-status-dot"></span>NO LOCK YET';
  radio.header.appendChild(radioStatus);

  const radioLabel = document.createElement('div');
  radioLabel.className = 'data-hero-label';
  radioLabel.textContent = 'RANGE = c · (t_received − t_sent)';
  const radioHero = document.createElement('div');
  radioHero.className = 'data-hero-value';
  radioHero.textContent = '—';
  const radioSub = document.createElement('div');
  radioSub.className = 'data-hero-sub';
  radioSub.textContent = '';
  const radioDivider = document.createElement('div');
  radioDivider.className = 'data-divider';
  const radioDirRow = row('Direction (Earth @ t_sent)', '—');
  const radioQualityRow = row('Signal quality', '—');
  const radioLastRow = row('Last lock', '—');
  const radioCountRow = row('History count', '0');
  const radioBtn = document.createElement('button');
  radioBtn.className = 'data-btn';
  radioBtn.textContent = 'radio.lockEarth() — new lock';
  radioBtn.addEventListener('click', () => deps.send({ type: 'radioLockEarth' }));

  radio.body.append(
    radioLabel,
    radioHero,
    radioSub,
    radioDivider,
    radioDirRow,
    radioQualityRow,
    radioLastRow,
    radioCountRow,
    radioBtn,
  );

  function renderRadio(): void {
    if (!lastRadioLock) {
      radioStatus.className = 'data-status-badge is-idle';
      radioStatus.innerHTML = '<span class="data-status-dot"></span>NO LOCK YET';
      radioHero.textContent = '—';
      radioSub.textContent = '';
      radioDirRow.querySelector('.value')!.textContent = '—';
      radioQualityRow.querySelector('.value')!.textContent = '—';
      radioLastRow.querySelector('.value')!.textContent = '—';
      radioCountRow.querySelector('.value')!.textContent = String(radioLockCount);
      return;
    }
    radioStatus.className = 'data-status-badge is-ok';
    radioStatus.innerHTML = '<span class="data-status-dot"></span>LEVEL 1 LOCK';
    radioHero.textContent = fmtKm(lastRadioLock.rangeMeters);
    const lightTime = lastRadioLock.tReceived - lastRadioLock.tSent;
    radioSub.textContent = `${fmtScientific(lastRadioLock.rangeMeters, 8)} m · light-time ${lightTime.toFixed(2)} s`;
    radioDirRow.querySelector('.value')!.textContent = fmtVec(lastRadioLock.direction);
    radioQualityRow.querySelector('.value')!.textContent =
      lastRadioLock.quality >= 1 ? 'NOMINAL' : lastRadioLock.quality.toFixed(2);
    (radioQualityRow.querySelector('.value') as HTMLElement).className = 'value is-ok';
    radioLastRow.querySelector('.value')!.textContent = fmtUtc(lastRadioLock.tReceived);
    radioCountRow.querySelector('.value')!.textContent = String(radioLockCount);
  }

  // ==================== 2. Ship data ====================
  const shipCard = card('data-card--span-4', 'SHIP DATA · self-knowledge only');
  const shipRows = {
    mass: row('Mass', '12,000 kg'),
    maxAccel: row('Max acceleration', '—'),
    maxThrust: row('Equivalent max thrust', '—'),
    attitude: row('Attitude (forward, inertial)', '—'),
    engine: row('Engine state', 'IDLE'),
    deltaV: row('Δv spent (cumulative)', '0.000 km/s'),
    clock: row('Mission clock', '—'),
  };
  const shipNote = document.createElement('div');
  shipNote.className = 'data-note';
  shipNote.textContent = 'Position & velocity are never shown — earn them through instruments.';
  shipCard.body.append(
    shipRows.mass,
    shipRows.maxAccel,
    shipRows.maxThrust,
    shipRows.attitude,
    shipRows.engine,
    shipRows.deltaV,
    shipRows.clock,
    shipNote,
  );

  const DEFAULT_MAX_ACCEL = 0.5;
  const SHIP_MASS_KG = 12000;

  function renderShip(): void {
    const maxAccel = DEFAULT_MAX_ACCEL;
    shipRows.maxAccel.querySelector('.value')!.textContent = `${maxAccel.toFixed(2)} m/s²`;
    shipRows.maxThrust.querySelector('.value')!.textContent = `${(SHIP_MASS_KG * maxAccel).toLocaleString('en-US')} N`;
    if (ship) {
      shipRows.attitude.querySelector('.value')!.textContent = fmtVec(ship.forward);
      const engineVal = shipRows.engine.querySelector('.value') as HTMLElement;
      engineVal.textContent = ship.burning ? 'BURNING' : 'IDLE';
      engineVal.className = ship.burning ? 'value is-ok' : 'value';
      shipRows.deltaV.querySelector('.value')!.textContent = fmtKmPerS(ship.deltaVSpent);
    }
    shipRows.clock.querySelector('.value')!.textContent = `${fmtUtc(simTime)} · ${fmtMet(missionElapsed)}`;
  }

  // ==================== 3. Scheduled burns ====================
  const burnsCard = card('data-card--span-5', 'SCHEDULED BURNS · point-then-burn');
  const burnsList = document.createElement('div');
  burnsCard.body.appendChild(burnsList);

  function renderBurns(): void {
    burnsList.textContent = '';
    if (liveBurn) {
      const b = document.createElement('div');
      b.className = 'data-burn-card';
      const header = document.createElement('div');
      header.className = 'data-burn-card-header';
      const idEl = document.createElement('span');
      idEl.innerHTML = '<span class="data-burn-id">LIVE</span>';
      const status = document.createElement('span');
      status.className = 'data-burn-status is-live';
      status.textContent = 'BURNING';
      idEl.appendChild(status);
      header.appendChild(idEl);
      b.appendChild(header);
      const grid = document.createElement('div');
      grid.className = 'data-burn-grid';
      grid.innerHTML = `
        <div><span class="k">t_start </span><span class="v">${fmtUtc(liveBurn.startTime)}</span></div>
        <div><span class="k">t_end </span><span class="v">${fmtUtc(liveBurn.endTime)}</span></div>
        <div class="span-2"><span class="k">throttle </span><span class="v">${(liveBurn.throttle * 100).toFixed(0)}%</span></div>
      `;
      b.appendChild(grid);
      burnsList.appendChild(b);
    }
    if (scheduledBurns.length === 0 && !liveBurn) {
      const empty = document.createElement('div');
      empty.className = 'data-empty';
      empty.textContent = 'No scheduled burns.';
      burnsList.appendChild(empty);
      return;
    }
    for (const b of scheduledBurns) {
      const el = document.createElement('div');
      el.className = 'data-burn-card';
      const header = document.createElement('div');
      header.className = 'data-burn-card-header';
      const left = document.createElement('span');
      left.innerHTML = `<span class="data-burn-id">#${b.id}</span><span class="data-burn-status">SCHEDULED</span>`;
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'data-burn-cancel';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => deps.send({ type: 'cancelBurn', id: b.id }));
      header.append(left, cancelBtn);
      el.appendChild(header);

      const deltaV = b.throttle * DEFAULT_MAX_ACCEL * b.duration;
      const grid = document.createElement('div');
      grid.className = 'data-burn-grid';
      grid.innerHTML = `
        <div><span class="k">t_start </span><span class="v">${fmtUtc(b.startTime)}</span></div>
        <div><span class="k">Δv </span><span class="v">${fmtKmPerS(deltaV)}</span></div>
        <div><span class="k">throttle </span><span class="v">${(b.throttle * 100).toFixed(0)}%</span></div>
        <div><span class="k">duration </span><span class="v">${b.duration.toFixed(1)} s</span></div>
        <div class="span-2"><span class="k">direction </span><span class="v">${fmtVec(b.direction)}</span></div>
      `;
      el.appendChild(grid);
      burnsList.appendChild(el);
    }
  }

  // ==================== 4. Inserted-state analysis ====================
  const analysisCard = card('data-card--span-5', 'INSERTED-STATE ANALYSIS');
  const refToggle = document.createElement('div');
  refToggle.className = 'data-toggle-group';
  const solarBtn = document.createElement('button');
  solarBtn.className = 'data-toggle-btn is-active';
  solarBtn.textContent = 'SOLAR';
  const earthBtn = document.createElement('button');
  earthBtn.className = 'data-toggle-btn';
  earthBtn.textContent = 'EARTH';
  refToggle.append(solarBtn, earthBtn);
  analysisCard.header.appendChild(refToggle);

  let referenceFrame: OrbitReferenceFrame = 'solar';

  const candidateSelectRow = document.createElement('div');
  candidateSelectRow.className = 'data-state-form-row';
  const candidateSelect = document.createElement('select');
  candidateSelect.className = 'data-select';
  candidateSelect.style.flex = '1';
  const candidateLabel = document.createElement('span');
  candidateLabel.className = 'label';
  candidateLabel.style.fontSize = '10px';
  candidateLabel.style.color = 'var(--text-muted)';
  candidateLabel.textContent = 'load from candidate:';
  candidateSelectRow.append(candidateLabel, candidateSelect);

  const stateForm = document.createElement('div');
  stateForm.className = 'data-state-form';
  function labeledInput(placeholder: string): HTMLInputElement {
    const input = document.createElement('input');
    input.className = 'data-input';
    input.type = 'number';
    input.step = 'any';
    input.placeholder = placeholder;
    input.style.width = '100%';
    return input;
  }
  const posX = labeledInput('x (km)');
  const posY = labeledInput('y (km)');
  const posZ = labeledInput('z (km)');
  const velX = labeledInput('vx (km/s)');
  const velY = labeledInput('vy (km/s)');
  const velZ = labeledInput('vz (km/s)');
  stateForm.append(posX, posY, posZ, velX, velY, velZ);

  const epochRow = document.createElement('div');
  epochRow.className = 'data-state-form-row';
  const epochLabel = document.createElement('span');
  epochLabel.className = 'label';
  epochLabel.style.fontSize = '10px';
  epochLabel.style.color = 'var(--text-muted)';
  epochLabel.textContent = 'epoch (UTC):';
  const epochInput = document.createElement('input');
  epochInput.className = 'data-input';
  epochInput.type = 'datetime-local';
  epochInput.style.flex = '1';
  epochRow.append(epochLabel, epochInput);

  const horizonRow = document.createElement('div');
  horizonRow.className = 'data-horizon-row';
  const horizons: readonly { label: string; days: number }[] = [
    { label: '1d', days: 1 },
    { label: '7d', days: 7 },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
  ];
  let selectedHorizonDays = 30;
  const horizonButtons: HTMLButtonElement[] = [];
  for (const h of horizons) {
    const btn = document.createElement('button');
    btn.className = 'data-horizon-btn' + (h.days === selectedHorizonDays ? ' is-active' : '');
    btn.textContent = h.label;
    btn.addEventListener('click', () => {
      selectedHorizonDays = h.days;
      for (const b of horizonButtons) b.classList.remove('is-active');
      btn.classList.add('is-active');
    });
    horizonButtons.push(btn);
    horizonRow.appendChild(btn);
  }

  const analyzeBtn = document.createElement('button');
  analyzeBtn.className = 'data-btn';
  analyzeBtn.textContent = 'Analyze inserted state';

  const closestApproachBox = document.createElement('div');
  closestApproachBox.className = 'data-closest-approach';
  closestApproachBox.textContent = 'No analysis run yet.';

  const estimateBadge = document.createElement('div');
  estimateBadge.className = 'data-estimate-badge';
  estimateBadge.textContent = 'ESTIMATE-DERIVED — never validated against actual state';

  const elementsGrid = document.createElement('div');
  elementsGrid.className = 'data-elements-grid';

  const planeNote = document.createElement('div');
  planeNote.className = 'data-note';
  planeNote.textContent = 'Periapsis / apoapsis are center-distances; inclination against the solar ecliptic plane.';

  analysisCard.body.append(
    candidateSelectRow,
    stateForm,
    epochRow,
    horizonRow,
    analyzeBtn,
    closestApproachBox,
    estimateBadge,
    elementsGrid,
    planeNote,
  );

  let activeChunkedRun: ChunkedRunHandle | null = null;

  function renderCandidateSelect(): void {
    const prev = candidateSelect.value;
    candidateSelect.textContent = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— none —';
    candidateSelect.appendChild(blank);
    for (const c of deps.candidates.list()) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      candidateSelect.appendChild(opt);
    }
    candidateSelect.value = prev;
  }

  candidateSelect.addEventListener('change', () => {
    const c = deps.candidates.get(candidateSelect.value);
    if (!c) return;
    posX.value = String(c.position.x / 1000);
    posY.value = String(c.position.y / 1000);
    posZ.value = String(c.position.z / 1000);
    velX.value = String(c.velocity.x / 1000);
    velY.value = String(c.velocity.y / 1000);
    velZ.value = String(c.velocity.z / 1000);
    epochInput.value = new Date(c.epoch * 1000).toISOString().slice(0, 16);
  });

  function readInsertedState(): InsertedState | null {
    const nums = [posX, posY, posZ, velX, velY, velZ].map((i) => Number(i.value));
    if (nums.some((n) => !Number.isFinite(n))) return null;
    const [x, y, z, vx, vy, vz] = nums as [number, number, number, number, number, number];
    const epoch = epochInput.value ? Math.floor(new Date(epochInput.value).getTime() / 1000) : simTime;
    return {
      position: { x: x * 1000, y: y * 1000, z: z * 1000 },
      velocity: { x: vx * 1000, y: vy * 1000, z: vz * 1000 },
      epoch,
    };
  }

  function renderOrbitalElements(inserted: InsertedState): void {
    const { elements } = insertedOrbitalElements(inserted, deps.ephemeris, referenceFrame);
    const periLabel = referenceFrame === 'earth' ? 'Perigee (periapsis)' : 'Periapsis';
    const apoLabel = referenceFrame === 'earth' ? 'Apogee (apoapsis)' : 'Apoapsis';
    const rows: readonly [string, string][] = [
      ['Semi-major axis', fmtKm(elements.semiMajorAxis)],
      ['Eccentricity', fmtNumber(elements.eccentricity, 4)],
      ['Inclination', fmtDegrees(elements.inclination)],
      [periLabel, fmtKm(elements.periapsis)],
      [apoLabel, elements.apoapsis === Infinity ? '∞ (unbound)' : fmtKm(elements.apoapsis)],
      ['Period', elements.period === null ? '— (unbound)' : `${(elements.period / 86400).toFixed(2)} days`],
    ];
    elementsGrid.textContent = '';
    for (const [k, v] of rows) {
      const r = document.createElement('div');
      r.style.display = 'flex';
      r.style.justifyContent = 'space-between';
      r.style.alignItems = 'baseline';
      r.style.borderBottom = '1px solid var(--border-row)';
      r.style.paddingBottom = '7px';
      r.innerHTML = `<span style="font-size:11px;color:var(--text-tertiary)">${k}</span><span style="font-family:var(--font-mono);font-size:11.5px;color:var(--text-secondary)">${v}</span>`;
      elementsGrid.appendChild(r);
    }
    planeNote.textContent = `Periapsis / apoapsis are center-distances; inclination against the ${
      referenceFrame === 'earth' ? 'Earth ecliptic' : 'solar ecliptic'
    } plane.`;
  }

  function setReferenceFrame(frame: OrbitReferenceFrame): void {
    referenceFrame = frame;
    solarBtn.classList.toggle('is-active', frame === 'solar');
    earthBtn.classList.toggle('is-active', frame === 'earth');
    const inserted = readInsertedState();
    if (inserted) renderOrbitalElements(inserted);
  }
  solarBtn.addEventListener('click', () => setReferenceFrame('solar'));
  earthBtn.addEventListener('click', () => setReferenceFrame('earth'));

  analyzeBtn.addEventListener('click', () => {
    const inserted = readInsertedState();
    if (!inserted) {
      closestApproachBox.textContent = 'Enter a complete position, velocity, and epoch first.';
      return;
    }
    renderOrbitalElements(inserted);

    activeChunkedRun?.cancel();
    closestApproachBox.textContent = 'Propagating… 0%';
    const horizonSeconds = selectedHorizonDays * 86400;
    activeChunkedRun = runClosestApproachChunked(
      inserted,
      deps.ephemeris,
      horizonSeconds,
      (result) => {
        closestApproachBox.innerHTML =
          `<span class="label" style="font-size:10px;color:var(--text-muted)">CLOSEST APPROACH TO EARTH${
            result.reachedHorizon ? '' : ' (ephemeris coverage ended early)'
          }</span><br/>` +
          `<span style="font-family:var(--font-mono);font-size:16px;color:var(--accent)">${fmtKm(result.distanceMeters)}</span> ` +
          `<span style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">@ ${fmtUtc(result.atTime)}</span>`;
      },
      (fraction) => {
        closestApproachBox.textContent = `Propagating… ${(fraction * 100).toFixed(0)}%`;
      },
    );
  });

  // ==================== assembly ====================
  root.append(radio.el, shipCard.el, burnsCard.el, analysisCard.el);

  renderCandidateSelect();
  const unsubscribeCandidates = deps.candidates.subscribe(renderCandidateSelect);

  function render(): void {
    renderRadio();
    renderShip();
    renderBurns();
  }
  render();

  function onSimEvent(e: SimEvent): void {
    switch (e.type) {
      case 'ready':
        lastRadioLock = null;
        radioLockCount = 0;
        scheduledBurns = [];
        liveBurn = null;
        render();
        break;
      case 'state': {
        ship = e.ship;
        simTime = e.simTime;
        missionElapsed = e.missionElapsed;
        render();
        break;
      }
      case 'measurementAdded': {
        const ev = e as MeasurementAddedEvent;
        if (ev.measurement.data.kind === 'radioLock') {
          lastRadioLock = ev.measurement.data;
          radioLockCount += 1;
        }
        render();
        break;
      }
      case 'burnStarted': {
        const ev = e as BurnStartedEvent;
        liveBurn = { startTime: ev.startTime, endTime: ev.endTime, throttle: ev.throttle };
        renderBurns();
        break;
      }
      case 'burnEnded': {
        void (e as BurnEndedEvent);
        liveBurn = null;
        renderBurns();
        break;
      }
      case 'scheduledBurnAdded': {
        const ev = e as ScheduledBurnAddedEvent;
        scheduledBurns = [...scheduledBurns, ev.burn];
        renderBurns();
        break;
      }
      case 'scheduledBurnCancelled': {
        const ev = e as ScheduledBurnCancelledEvent;
        scheduledBurns = scheduledBurns.filter((b) => b.id !== ev.id);
        renderBurns();
        break;
      }
      case 'ephemerisResult': {
        void (e as EphemerisResultEvent);
        break;
      }
      default:
        break;
    }
  }
  deps.addSimListener(onSimEvent);

  return {
    destroy(): void {
      deps.removeSimListener(onSimEvent);
      unsubscribeCandidates();
      activeChunkedRun?.cancel();
      root.textContent = '';
      root.classList.remove('data-screen');
    },
  };
}

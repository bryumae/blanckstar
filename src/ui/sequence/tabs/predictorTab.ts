// Trajectory Predictor tab DOM (mvp0_spec.md §7.7): initial-state form
// (with load-from-candidate), burn list, duration/step controls, chunked async
// propagation with progress + cancel, and TABLE-ONLY output (summary cards +
// time-series table). Propagation logic lives in ./predictorEngine.ts.
import type { Vector3 } from '../../../core/vector3';
import type { EphemerisData } from '../../../core/ephemerisTypes';
import { R_SOI_EARTH, MAX_ACCELERATION } from '../../../core/constants';
import type { CandidateStore } from '../../candidateStore';
import { propagateForPredictionChunked, type PredictorBurn, type PredictorResult } from './predictorEngine';

export interface PredictorTabDeps {
  readonly ephemeris: EphemerisData;
  readonly candidates: CandidateStore;
}

function fmtUtc(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace('.000Z', 'Z');
}
function fmtKm(meters: number, digits = 0): string {
  return `${(meters / 1000).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })} km`;
}
function fmtKmVec(v: Vector3, digits = 3): string {
  return `(${(v.x / 1000).toExponential(digits)}, ${(v.y / 1000).toExponential(digits)}, ${(v.z / 1000).toExponential(digits)}) km`;
}

function field(labelText: string, placeholder = ''): { wrap: HTMLDivElement; input: HTMLInputElement } {
  const wrap = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.placeholder = placeholder;
  wrap.append(label, input);
  return { wrap, input };
}

export function mountPredictorTab(root: HTMLElement, deps: PredictorTabDeps): void {
  root.className = 'pred-tab';

  // ---- form panel ----
  const formPanel = document.createElement('div');
  formPanel.className = 'form-panel';
  const formTitle = document.createElement('div');
  formTitle.className = 'panel-title';
  formTitle.textContent = 'INPUT STATE';
  formPanel.appendChild(formTitle);

  const loadRow = document.createElement('div');
  loadRow.className = 'form-grid';
  const candidateSelect = document.createElement('select');
  const candidateOptWrap = document.createElement('div');
  const candidateLabel = document.createElement('label');
  candidateLabel.textContent = 'LOAD FROM CANDIDATE';
  candidateOptWrap.append(candidateLabel, candidateSelect);
  loadRow.append(candidateOptWrap);
  formPanel.appendChild(loadRow);

  const stateGrid = document.createElement('div');
  stateGrid.className = 'form-grid';
  const epochF = field('EPOCH (UTC)', 'YYYY-MM-DDTHH:mm:ssZ');
  const pxF = field('POS X (km)');
  const pyF = field('POS Y (km)');
  const pzF = field('POS Z (km)');
  const vxF = field('VEL X (km/s)');
  const vyF = field('VEL Y (km/s)');
  const vzF = field('VEL Z (km/s)');
  stateGrid.append(epochF.wrap, pxF.wrap, pyF.wrap, pzF.wrap, vxF.wrap, vyF.wrap, vzF.wrap);
  formPanel.appendChild(stateGrid);

  function refreshCandidateOptions(): void {
    const selected = candidateSelect.value;
    candidateSelect.textContent = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '(manual entry)';
    candidateSelect.appendChild(none);
    for (const c of deps.candidates.list()) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      candidateSelect.appendChild(opt);
    }
    candidateSelect.value = selected;
  }
  deps.candidates.subscribe(refreshCandidateOptions);
  refreshCandidateOptions();

  candidateSelect.addEventListener('change', () => {
    const c = deps.candidates.get(candidateSelect.value);
    if (!c) return;
    epochF.input.value = fmtUtc(c.epoch);
    pxF.input.value = String(c.position.x / 1000);
    pyF.input.value = String(c.position.y / 1000);
    pzF.input.value = String(c.position.z / 1000);
    vxF.input.value = String(c.velocity.x / 1000);
    vyF.input.value = String(c.velocity.y / 1000);
    vzF.input.value = String(c.velocity.z / 1000);
  });

  // ---- burn list ----
  const burnsTitle = document.createElement('div');
  burnsTitle.className = 'panel-title';
  burnsTitle.textContent = 'BURNS (optional)';
  formPanel.appendChild(burnsTitle);
  const burnsList = document.createElement('div');
  burnsList.style.display = 'flex';
  burnsList.style.flexDirection = 'column';
  burnsList.style.gap = '6px';
  formPanel.appendChild(burnsList);

  interface BurnRow {
    readonly row: HTMLDivElement;
    readonly startUtc: HTMLInputElement;
    readonly dx: HTMLInputElement;
    readonly dy: HTMLInputElement;
    readonly dz: HTMLInputElement;
    readonly throttle: HTMLInputElement;
    readonly duration: HTMLInputElement;
  }
  const burnRows: BurnRow[] = [];

  function addBurnRow(): void {
    const row = document.createElement('div');
    row.className = 'burn-row';
    const startUtc = document.createElement('input');
    startUtc.placeholder = 'start UTC';
    const dx = document.createElement('input');
    dx.placeholder = 'dir x';
    const dy = document.createElement('input');
    dy.placeholder = 'dir y';
    const dz = document.createElement('input');
    dz.placeholder = 'dir z';
    const throttle = document.createElement('input');
    throttle.placeholder = 'throttle 0-1';
    const duration = document.createElement('input');
    duration.placeholder = 'duration s';
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      row.remove();
      const idx = burnRows.findIndex((b) => b.row === row);
      if (idx >= 0) burnRows.splice(idx, 1);
    });
    row.append(startUtc, dx, dy, dz, throttle, duration, removeBtn);
    burnsList.appendChild(row);
    burnRows.push({ row, startUtc, dx, dy, dz, throttle, duration });
  }
  const addBurnBtn = document.createElement('button');
  addBurnBtn.textContent = '+ Add burn';
  addBurnBtn.addEventListener('click', () => addBurnRow());
  formPanel.appendChild(addBurnBtn);

  // ---- duration/step + run controls ----
  const runGrid = document.createElement('div');
  runGrid.className = 'form-grid';
  const durationF = field('DURATION (days)');
  durationF.input.value = '30';
  const stepF = field('OUTPUT STEP (hours)');
  stepF.input.value = '48';
  runGrid.append(durationF.wrap, stepF.wrap);
  formPanel.appendChild(runGrid);

  const runBtn = document.createElement('button');
  runBtn.textContent = 'Run prediction';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'danger';
  cancelBtn.disabled = true;
  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap = '8px';
  btnRow.append(runBtn, cancelBtn);
  formPanel.appendChild(btnRow);

  const progressLine = document.createElement('div');
  progressLine.className = 'progress-line';
  progressLine.style.display = 'none';
  const progressTrack = document.createElement('div');
  progressTrack.className = 'progress-track';
  const progressFill = document.createElement('div');
  progressFill.className = 'progress-fill';
  progressFill.style.width = '0%';
  progressTrack.appendChild(progressFill);
  const progressText = document.createElement('span');
  progressText.textContent = '0%';
  progressLine.append(progressTrack, progressText);
  formPanel.appendChild(progressLine);

  // ---- summary cards ----
  const cardsRow = document.createElement('div');
  cardsRow.className = 'cards-row';
  const inputCard = document.createElement('div');
  inputCard.className = 'card';
  const modelCard = document.createElement('div');
  modelCard.className = 'card';
  const caCard = document.createElement('div');
  caCard.className = 'card closest-approach';
  cardsRow.append(inputCard, modelCard, caCard);

  function renderCards(input: { epoch: number; position: Vector3; velocity: Vector3 }, burns: readonly PredictorBurn[], durationDays: number, stepHours: number, result: PredictorResult | null): void {
    inputCard.textContent = '';
    const t1 = document.createElement('div');
    t1.className = 'panel-title';
    t1.textContent = 'INPUT STATE';
    const v1 = document.createElement('div');
    v1.className = 'card-value';
    v1.textContent = fmtUtc(input.epoch);
    const v2 = document.createElement('div');
    v2.className = 'card-sub';
    v2.innerHTML = `r ${fmtKmVec(input.position)}<br>v ${fmtKmVec(input.velocity).replace(' km', ' km/s')}`;
    inputCard.append(t1, v1, v2);

    modelCard.textContent = '';
    const t2 = document.createElement('div');
    t2.className = 'panel-title';
    t2.textContent = 'MODEL';
    const v3 = document.createElement('div');
    v3.className = 'card-value';
    v3.textContent = 'RK4 · Sun+Earth+Moon';
    const v4 = document.createElement('div');
    v4.className = 'card-sub';
    v4.textContent = `horizon ${durationDays} d · step ${stepHours} h${burns.length > 0 ? ` + ${burns.length} burn${burns.length === 1 ? '' : 's'}` : ''}`;
    modelCard.append(t2, v3, v4);

    caCard.textContent = '';
    const t3 = document.createElement('div');
    t3.className = 'panel-title';
    t3.textContent = 'CLOSEST APPROACH TO EARTH';
    caCard.appendChild(t3);
    if (result) {
      const hero = document.createElement('div');
      hero.className = 'ca-hero';
      const value = document.createElement('span');
      value.className = 'value';
      value.textContent = fmtKm(result.closestApproach.distanceEarth);
      const met = document.createElement('span');
      met.className = 'met';
      met.textContent = `@ ${fmtUtc(result.closestApproach.t)}`;
      hero.append(value, met);
      const status = document.createElement('div');
      status.className = 'ca-status';
      status.textContent =
        result.closestApproach.distanceEarth < R_SOI_EARTH
          ? '▼ within R_SOI Earth (929 000 km) — inside sphere of influence'
          : '▲ above R_SOI Earth (929 000 km) — capture not yet achieved';
      caCard.append(hero, status);
    } else {
      const hint = document.createElement('div');
      hint.className = 'card-sub';
      hint.textContent = 'Run a prediction to compute closest approach.';
      caCard.appendChild(hint);
    }
  }
  renderCards({ epoch: 0, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }, [], 30, 48, null);

  // ---- time-series table ----
  const tableWrap = document.createElement('div');
  tableWrap.className = 'table-wrap';
  const tableHeader = document.createElement('div');
  tableHeader.className = 'table-header';
  const tableTitle = document.createElement('span');
  tableTitle.textContent = 'TRAJECTORY PREDICTION · tables only';
  const tableHint = document.createElement('span');
  tableHint.style.color = 'var(--text-faint)';
  tableHint.style.fontWeight = '400';
  tableHint.style.letterSpacing = '0';
  tableHint.textContent = 'predict(state, burns, duration, step) — same engine as simulation, never validates truth';
  tableHeader.append(tableTitle, tableHint);
  const tableBody = document.createElement('div');
  tableWrap.append(tableHeader, tableBody);

  function renderTable(result: PredictorResult | null): void {
    tableBody.textContent = '';
    if (!result) {
      const empty = document.createElement('div');
      empty.className = 'empty-hint';
      empty.textContent = 'Run a prediction to populate this table.';
      tableBody.appendChild(empty);
      return;
    }
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.innerHTML =
      '<tr><th>UTC</th><th>MET</th><th>POSITION (km)</th><th>d · EARTH (km)</th><th>d · MOON (km)</th><th>d · MARS (km)</th><th>v_rel EARTH (km/s)</th></tr>';
    const tbody = document.createElement('tbody');
    const startT = result.samples[0]!.t;
    for (const s of result.samples) {
      const tr = document.createElement('tr');
      const isClosest = Math.abs(s.t - result.closestApproach.t) < 1e-6;
      if (isClosest) tr.className = 'closest';
      const met = s.t - startT;
      const days = Math.floor(met / 86400);
      const hours = Math.floor((met % 86400) / 3600);
      const mins = Math.floor((met % 3600) / 60);
      const metStr = `+${days}d ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
      tr.innerHTML =
        `<td>${fmtUtc(s.t)}</td><td>${metStr}</td><td>${fmtKmVec(s.position)}</td>` +
        `<td>${fmtKm(s.distanceEarth)}</td><td>${fmtKm(s.distanceMoon)}</td><td>${fmtKm(s.distanceMars)}</td>` +
        `<td>${(s.earthRelativeSpeed / 1000).toFixed(3)}</td>`;
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    tableBody.appendChild(table);
  }
  renderTable(null);

  root.append(formPanel, cardsRow, tableWrap);

  // ---- run/cancel wiring ----
  let cancelled = false;
  let running = false;

  function parseEpoch(input: string): number | null {
    const t = Date.parse(input);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  }

  runBtn.addEventListener('click', () => {
    if (running) return;
    const epoch = parseEpoch(epochF.input.value);
    const px = parseFloat(pxF.input.value);
    const py = parseFloat(pyF.input.value);
    const pz = parseFloat(pzF.input.value);
    const vx = parseFloat(vxF.input.value);
    const vy = parseFloat(vyF.input.value);
    const vz = parseFloat(vzF.input.value);
    const durationDays = parseFloat(durationF.input.value);
    const stepHours = parseFloat(stepF.input.value);
    if (
      epoch === null ||
      [px, py, pz, vx, vy, vz, durationDays, stepHours].some((n) => !Number.isFinite(n)) ||
      durationDays < 0 ||
      stepHours <= 0
    ) {
      // eslint-disable-next-line no-alert
      alert('Fill in a valid UTC epoch, numeric position (km) / velocity (km/s), a non-negative duration, and a positive output step.');
      return;
    }

    const burns: PredictorBurn[] = [];
    for (const b of burnRows) {
      const startTime = parseEpoch(b.startUtc.value);
      const dx = parseFloat(b.dx.value);
      const dy = parseFloat(b.dy.value);
      const dz = parseFloat(b.dz.value);
      const throttle = parseFloat(b.throttle.value);
      const duration = parseFloat(b.duration.value);
      if (startTime === null || [dx, dy, dz, throttle, duration].some((n) => !Number.isFinite(n))) continue;
      burns.push({ startTime, direction: { x: dx, y: dy, z: dz }, throttle, duration });
    }

    const input = { position: { x: px * 1000, y: py * 1000, z: pz * 1000 }, velocity: { x: vx * 1000, y: vy * 1000, z: vz * 1000 }, epoch };
    renderCards(input, burns, durationDays, stepHours, null);
    renderTable(null);

    cancelled = false;
    running = true;
    runBtn.disabled = true;
    cancelBtn.disabled = false;
    progressLine.style.display = 'flex';
    progressFill.style.width = '0%';
    progressText.textContent = '0%';

    propagateForPredictionChunked(
      deps.ephemeris,
      input,
      burns,
      durationDays * 86400,
      stepHours * 3600,
      {
        maxAcceleration: MAX_ACCELERATION,
        chunkSeconds: 86400,
        isCancelled: () => cancelled,
        onProgress: (fraction) => {
          const pct = Math.round(fraction * 100);
          progressFill.style.width = `${pct}%`;
          progressText.textContent = `${pct}%`;
        },
      },
    ).then((result) => {
      running = false;
      runBtn.disabled = false;
      cancelBtn.disabled = true;
      if (result) {
        renderCards(input, burns, durationDays, stepHours, result);
        renderTable(result);
      } else {
        progressText.textContent = 'cancelled';
      }
    });
  });

  cancelBtn.addEventListener('click', () => {
    cancelled = true;
  });
}

// Candidates tab DOM (mvp0_spec.md §7.6, bryum §13 workflow): (a) saved
// candidate-estimate manager, (b) candidate-search table over logged
// measurements, (c) free-text notes with import/export. Residual math lives in
// ./candidateSearch.ts; this module is DOM wiring + the injected storage/export
// seams only.
import type { Vector3 } from '../../../core/vector3';
import { positionAt } from '../../../core/ephemerisInterp';
import type { EphemerisData } from '../../../core/ephemerisTypes';
import type { StorageLike } from '../../../net/storage';
import { readJson, writeJson } from '../../../net/storage';
import type { CandidateEstimate, CandidateStore } from '../../candidateStore';
import type { BodyId, Measurement } from '../../../sim/types';
import {
  evaluateCandidateAgainstMeasurements,
  positionGridCount,
  generatePositionGrid,
  MAX_CANDIDATE_EVALUATIONS,
  type BodyPositionAt,
  type Range3,
} from './candidateSearch';

export interface CandidatesTabDeps {
  readonly ephemeris: EphemerisData;
  readonly storage: StorageLike;
  readonly candidates: CandidateStore;
  readonly getMeasurements: () => readonly Measurement[];
  readonly exportText: (filename: string, text: string) => void;
  readonly importText: () => Promise<string | null>;
}

const NOTES_KEY = 'blanckstar.notes.v1';

function fmtVecKm(v: Vector3, digits = 3): string {
  return `(${(v.x / 1000).toExponential(digits)}, ${(v.y / 1000).toExponential(digits)}, ${(v.z / 1000).toExponential(digits)})`;
}
function fmtVecKmS(v: Vector3, digits = 3): string {
  return `(${(v.x / 1000).toFixed(digits)}, ${(v.y / 1000).toFixed(digits)}, ${(v.z / 1000).toFixed(digits)})`;
}
function fmtUtc(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace('.000Z', 'Z');
}

let idCounter = 0;
function freshId(): string {
  idCounter += 1;
  return `c${Date.now().toString(36)}${idCounter.toString(36)}`;
}

const MEASUREMENT_LABELS: Readonly<Record<Measurement['data']['kind'], string>> = {
  radioLock: 'RADIO LOCK',
  sunDirection: 'SUN DIR',
  starAttitude: 'STAR ATTITUDE',
  angularSeparation: 'ANG SEP',
};

export function mountCandidatesTab(root: HTMLElement, deps: CandidatesTabDeps): void {
  root.classList.add('cand-tab');

  const bodyPositionAt: BodyPositionAt = (body: BodyId, t: number) => positionAt(deps.ephemeris, body, t);

  // ================= (a) Saved candidates manager =================
  const savedPanel = document.createElement('div');
  savedPanel.className = 'panel';
  const savedHeader = document.createElement('div');
  savedHeader.className = 'panel-header';
  const savedTitle = document.createElement('span');
  savedTitle.className = 'label';
  savedTitle.textContent = 'SAVED STATE CANDIDATES · position + velocity estimates';
  const savedHint = document.createElement('span');
  savedHint.className = 'hint';
  savedHint.textContent = 'persisted · localStorage · unlimited';
  savedHeader.append(savedTitle, savedHint);

  const newForm = document.createElement('div');
  newForm.className = 'grid-form';
  function field(labelText: string, placeholder = ''): { wrap: HTMLDivElement; input: HTMLInputElement } {
    const wrap = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.placeholder = placeholder;
    wrap.append(label, input);
    return { wrap, input };
  }
  const nameField = field('NAME');
  const epochField = field('EPOCH (UTC)', 'YYYY-MM-DDTHH:mm:ssZ');
  const pxField = field('POS X (km)');
  const pyField = field('POS Y (km)');
  const pzField = field('POS Z (km)');
  const vxField = field('VEL X (km/s)');
  const vyField = field('VEL Y (km/s)');
  const vzField = field('VEL Z (km/s)');
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save candidate';
  newForm.append(
    nameField.wrap,
    epochField.wrap,
    pxField.wrap,
    pyField.wrap,
    pzField.wrap,
    vxField.wrap,
    vyField.wrap,
    vzField.wrap,
    saveBtn,
  );

  const savedTableWrap = document.createElement('div');
  const savedNote = document.createElement('div');
  savedNote.className = 'search-footnote';
  savedNote.textContent = 'Consumed by the Data screen’s inserted-state analysis (select any saved candidate there).';

  savedPanel.append(savedHeader, newForm, savedTableWrap, savedNote);

  let editingId: string | null = null;

  function parseEpoch(input: string): number | null {
    const t = Date.parse(input);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  }

  saveBtn.addEventListener('click', () => {
    const name = nameField.input.value.trim();
    const epoch = parseEpoch(epochField.input.value);
    const px = parseFloat(pxField.input.value);
    const py = parseFloat(pyField.input.value);
    const pz = parseFloat(pzField.input.value);
    const vx = parseFloat(vxField.input.value);
    const vy = parseFloat(vyField.input.value);
    const vz = parseFloat(vzField.input.value);
    if (!name || epoch === null || [px, py, pz, vx, vy, vz].some((n) => !Number.isFinite(n))) {
      // eslint-disable-next-line no-alert
      alert('Fill in a name, a valid UTC epoch, and numeric position (km) + velocity (km/s).');
      return;
    }
    const candidate: CandidateEstimate = {
      id: editingId ?? freshId(),
      name,
      epoch,
      position: { x: px * 1000, y: py * 1000, z: pz * 1000 },
      velocity: { x: vx * 1000, y: vy * 1000, z: vz * 1000 },
      createdAt: Math.floor(Date.now() / 1000),
    };
    deps.candidates.save(candidate);
    editingId = null;
    saveBtn.textContent = 'Save candidate';
    for (const f of [nameField, epochField, pxField, pyField, pzField, vxField, vyField, vzField]) {
      f.input.value = '';
    }
  });

  function loadForEdit(c: CandidateEstimate): void {
    editingId = c.id;
    saveBtn.textContent = `Update ${c.name}`;
    nameField.input.value = c.name;
    epochField.input.value = fmtUtc(c.epoch);
    pxField.input.value = String(c.position.x / 1000);
    pyField.input.value = String(c.position.y / 1000);
    pzField.input.value = String(c.position.z / 1000);
    vxField.input.value = String(c.velocity.x / 1000);
    vyField.input.value = String(c.velocity.y / 1000);
    vzField.input.value = String(c.velocity.z / 1000);
  }

  function renderSaved(): void {
    savedTableWrap.textContent = '';
    const list = deps.candidates.list();
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-hint';
      empty.textContent = 'No saved candidates yet.';
      savedTableWrap.appendChild(empty);
      return;
    }
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.innerHTML =
      '<tr><th>NAME</th><th>EPOCH (UTC)</th><th>POSITION (km)</th><th>VELOCITY (km/s)</th><th>CREATED</th><th></th></tr>';
    const tbody = document.createElement('tbody');
    for (const c of [...list].sort((x, y) => y.createdAt - x.createdAt)) {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = c.name;
      tdName.style.color = 'var(--accent)';
      tdName.style.fontWeight = '600';
      const tdEpoch = document.createElement('td');
      tdEpoch.textContent = fmtUtc(c.epoch);
      const tdPos = document.createElement('td');
      tdPos.textContent = fmtVecKm(c.position);
      const tdVel = document.createElement('td');
      tdVel.textContent = fmtVecKmS(c.velocity);
      const tdCreated = document.createElement('td');
      tdCreated.textContent = fmtUtc(c.createdAt);
      const tdActions = document.createElement('td');
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        loadForEdit(c);
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'danger';
      delBtn.textContent = 'Delete';
      delBtn.style.marginLeft = '6px';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deps.candidates.remove(c.id);
      });
      tdActions.append(editBtn, delBtn);
      tr.append(tdName, tdEpoch, tdPos, tdVel, tdCreated, tdActions);
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    savedTableWrap.appendChild(table);
  }

  deps.candidates.subscribe(renderSaved);
  renderSaved();

  // ================= (b) Candidate-search table =================
  const searchPanel = document.createElement('div');
  searchPanel.className = 'panel';
  const searchHeader = document.createElement('div');
  searchHeader.className = 'panel-header';
  const searchTitle = document.createElement('span');
  searchTitle.className = 'label';
  searchTitle.textContent = 'CANDIDATE-SEARCH TABLE · constraint residuals vs logged measurements';
  const searchHint = document.createElement('span');
  searchHint.className = 'hint';
  searchHint.textContent = 'never labels a candidate correct';
  searchHeader.append(searchTitle, searchHint);

  const searchForm = document.createElement('div');
  searchForm.className = 'grid-form';
  const xMinF = field('X MIN (km)');
  const xMaxF = field('X MAX (km)');
  const yMinF = field('Y MIN (km)');
  const yMaxF = field('Y MAX (km)');
  const zMinF = field('Z MIN (km)');
  const zMaxF = field('Z MAX (km)');
  const stepF = field('STEP (km)');
  const vxFixF = field('VEL X (km/s)');
  const vyFixF = field('VEL Y (km/s)');
  const vzFixF = field('VEL Z (km/s)');
  const searchEpochF = field('EPOCH (UTC)', 'YYYY-MM-DDTHH:mm:ssZ');
  searchForm.append(
    xMinF.wrap, xMaxF.wrap, yMinF.wrap, yMaxF.wrap, zMinF.wrap, zMaxF.wrap, stepF.wrap,
    vxFixF.wrap, vyFixF.wrap, vzFixF.wrap, searchEpochF.wrap,
  );

  const measurementPicker = document.createElement('div');
  measurementPicker.className = 'measurement-picker';

  const searchFooter = document.createElement('div');
  searchFooter.className = 'search-footer';
  const countLabel = document.createElement('span');
  const runBtn = document.createElement('button');
  runBtn.textContent = 'Run candidate search';
  searchFooter.append(countLabel, runBtn);

  const searchResultsWrap = document.createElement('div');
  const searchFootnote = document.createElement('div');
  searchFootnote.className = 'search-footnote';
  searchFootnote.textContent =
    'residuals only — nothing here confirms a state. Each candidate is evaluated at each measurement’s own time, without propagating from the candidate’s stated epoch (a documented simplification — see candidateSearch.ts).';

  searchPanel.append(searchHeader, searchForm, measurementPicker, searchFooter, searchResultsWrap, searchFootnote);

  function renderMeasurementPicker(): void {
    measurementPicker.textContent = '';
    const measurements = deps.getMeasurements();
    if (measurements.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'empty-hint';
      hint.textContent = 'No measurements logged yet.';
      measurementPicker.appendChild(hint);
      return;
    }
    for (const m of measurements) {
      const chip = document.createElement('label');
      chip.className = 'measurement-chip';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.measurementId = String(m.id);
      const text = document.createElement('span');
      text.textContent = `#${m.id} ${MEASUREMENT_LABELS[m.data.kind]} @ ${fmtUtc(m.simTime)}`;
      chip.append(cb, text);
      measurementPicker.appendChild(chip);
    }
  }
  renderMeasurementPicker();

  function selectedMeasurements(): Measurement[] {
    const all = deps.getMeasurements();
    const checked = new Set(
      [...measurementPicker.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked')].map((cb) =>
        Number(cb.dataset.measurementId),
      ),
    );
    return all.filter((m) => checked.has(m.id));
  }

  function currentRange(): Range3 | null {
    const xMin = parseFloat(xMinF.input.value) * 1000;
    const xMax = parseFloat(xMaxF.input.value) * 1000;
    const yMin = parseFloat(yMinF.input.value) * 1000;
    const yMax = parseFloat(yMaxF.input.value) * 1000;
    const zMin = parseFloat(zMinF.input.value) * 1000;
    const zMax = parseFloat(zMaxF.input.value) * 1000;
    if ([xMin, xMax, yMin, yMax, zMin, zMax].some((n) => !Number.isFinite(n))) return null;
    return { xMin, xMax, yMin, yMax, zMin, zMax };
  }

  function currentStepMeters(): number | null {
    const step = parseFloat(stepF.input.value) * 1000;
    return Number.isFinite(step) && step > 0 ? step : null;
  }

  function updateCount(): void {
    const range = currentRange();
    const step = currentStepMeters();
    if (!range || !step) {
      countLabel.textContent = 'Enter numeric ranges + a positive step.';
      runBtn.disabled = true;
      return;
    }
    try {
      const n = positionGridCount(range, step);
      countLabel.textContent = `${n.toLocaleString('en-US')} candidate${n === 1 ? '' : 's'} to evaluate` + (n > MAX_CANDIDATE_EVALUATIONS ? ` — exceeds the ${MAX_CANDIDATE_EVALUATIONS.toLocaleString('en-US')} cap` : '');
      runBtn.disabled = n > MAX_CANDIDATE_EVALUATIONS || n === 0;
    } catch {
      countLabel.textContent = 'Invalid range.';
      runBtn.disabled = true;
    }
  }
  for (const f of [xMinF, xMaxF, yMinF, yMaxF, zMinF, zMaxF, stepF]) {
    f.input.addEventListener('input', updateCount);
  }
  updateCount();

  interface SearchRow {
    readonly index: number;
    readonly position: Vector3;
    readonly perMeasurement: Map<number, { rangeKm?: number; angleDeg?: number }>;
    readonly rms: number;
  }
  let lastRows: SearchRow[] = [];
  let lastMeasurements: Measurement[] = [];

  runBtn.addEventListener('click', () => {
    const range = currentRange();
    const step = currentStepMeters();
    if (!range || !step) return;
    const epoch = parseEpoch(searchEpochF.input.value) ?? Math.floor(Date.now() / 1000);
    const velocity: Vector3 = {
      x: (parseFloat(vxFixF.input.value) || 0) * 1000,
      y: (parseFloat(vyFixF.input.value) || 0) * 1000,
      z: (parseFloat(vzFixF.input.value) || 0) * 1000,
    };
    const measurements = selectedMeasurements();
    lastMeasurements = measurements;

    const rows: SearchRow[] = [];
    let i = 0;
    for (const position of generatePositionGrid(range, step)) {
      i += 1;
      const result = evaluateCandidateAgainstMeasurements({ position, velocity, epoch }, measurements, bodyPositionAt);
      const perMeasurement = new Map<number, { rangeKm?: number; angleDeg?: number }>();
      for (const r of result.residuals) {
        const entry: { rangeKm?: number; angleDeg?: number } = {};
        if (r.rangeResidualMeters !== undefined) entry.rangeKm = r.rangeResidualMeters / 1000;
        const angleRad = r.directionResidualRadians ?? r.angleResidualRadians;
        if (angleRad !== undefined) entry.angleDeg = (angleRad * 180) / Math.PI;
        perMeasurement.set(r.measurementId, entry);
      }
      rows.push({ index: i, position, perMeasurement, rms: result.rmsMismatch });
    }
    lastRows = rows;
    renderSearchResults();
  });

  function renderSearchResults(): void {
    searchResultsWrap.textContent = '';
    if (lastRows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-hint';
      empty.textContent = 'Run a candidate search to populate this table.';
      searchResultsWrap.appendChild(empty);
      return;
    }
    const table = document.createElement('table');
    table.className = 'dense';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.innerHTML = '<th>#</th><th>X (km)</th><th>Y (km)</th><th>Z (km)</th>';
    for (const m of lastMeasurements) {
      const th = document.createElement('th');
      th.textContent = `#${m.id} ${MEASUREMENT_LABELS[m.data.kind]}`;
      headRow.appendChild(th);
    }
    const totalTh = document.createElement('th');
    totalTh.textContent = 'MISMATCH';
    headRow.appendChild(totalTh);
    const saveTh = document.createElement('th');
    headRow.appendChild(saveTh);
    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');
    const sorted = [...lastRows].sort((a, b) => a.rms - b.rms);
    for (const row of sorted) {
      const tr = document.createElement('tr');
      const tdI = document.createElement('td');
      tdI.textContent = String(row.index);
      const tdX = document.createElement('td');
      tdX.textContent = (row.position.x / 1000).toExponential(3);
      const tdY = document.createElement('td');
      tdY.textContent = (row.position.y / 1000).toExponential(3);
      const tdZ = document.createElement('td');
      tdZ.textContent = (row.position.z / 1000).toExponential(3);
      tr.append(tdI, tdX, tdY, tdZ);
      for (const m of lastMeasurements) {
        const td = document.createElement('td');
        const entry = row.perMeasurement.get(m.id);
        if (entry?.rangeKm !== undefined) {
          td.textContent = `Δr ${entry.rangeKm.toFixed(1)} km`;
          if (entry.angleDeg !== undefined) td.textContent += ` · Δθ ${entry.angleDeg.toFixed(2)}°`;
        } else if (entry?.angleDeg !== undefined) {
          td.textContent = `${entry.angleDeg.toFixed(3)}°`;
        } else {
          td.textContent = '—';
        }
        tr.appendChild(td);
      }
      const tdTotal = document.createElement('td');
      tdTotal.textContent = row.rms.toPrecision(4);
      tdTotal.style.fontWeight = '600';
      tr.appendChild(tdTotal);
      const tdSave = document.createElement('td');
      const saveBtn2 = document.createElement('button');
      saveBtn2.textContent = 'Save as candidate';
      saveBtn2.addEventListener('click', () => {
        const epoch = parseEpoch(searchEpochF.input.value) ?? Math.floor(Date.now() / 1000);
        const velocity: Vector3 = {
          x: (parseFloat(vxFixF.input.value) || 0) * 1000,
          y: (parseFloat(vyFixF.input.value) || 0) * 1000,
          z: (parseFloat(vzFixF.input.value) || 0) * 1000,
        };
        deps.candidates.save({
          id: freshId(),
          name: `search-${row.index}`,
          epoch,
          position: row.position,
          velocity,
          createdAt: Math.floor(Date.now() / 1000),
        });
      });
      tdSave.appendChild(saveBtn2);
      tr.appendChild(tdSave);
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    searchResultsWrap.appendChild(table);
  }

  // ================= (c) Notes =================
  const notesPanel = document.createElement('div');
  notesPanel.className = 'panel';
  const notesHeader = document.createElement('div');
  notesHeader.className = 'panel-header';
  const notesTitle = document.createElement('span');
  notesTitle.className = 'label';
  notesTitle.textContent = 'NOTES';
  const notesActions = document.createElement('span');
  const exportBtn = document.createElement('button');
  exportBtn.textContent = 'Export .txt';
  const importBtn = document.createElement('button');
  importBtn.textContent = 'Import .txt';
  importBtn.style.marginLeft = '6px';
  notesActions.append(exportBtn, importBtn);
  notesHeader.append(notesTitle, notesActions);

  const notesArea = document.createElement('textarea');
  notesArea.className = 'notes';
  notesArea.value = readJson<string>(deps.storage, NOTES_KEY) ?? '';
  notesArea.addEventListener('input', () => {
    writeJson(deps.storage, NOTES_KEY, notesArea.value);
  });

  exportBtn.addEventListener('click', () => {
    deps.exportText('notes.txt', notesArea.value);
  });
  importBtn.addEventListener('click', () => {
    deps.importText().then((text) => {
      if (text !== null) {
        notesArea.value = text;
        writeJson(deps.storage, NOTES_KEY, text);
      }
    });
  });

  notesPanel.append(notesHeader, notesArea);

  root.append(savedPanel, searchPanel, notesPanel);
}

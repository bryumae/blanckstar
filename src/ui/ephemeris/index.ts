// Ephemeris screen (split out of Data — mvp0_spec.md §7.4 ephemeris query —
// promoted to a first-level nav screen since the query panel + table were
// getting cramped inside Data's 12-col grid). Plain DOM/CSS (repo rule 5),
// reuses Data's card/table styles (src/ui/data/data.css) since the visual
// language is identical.
import type { EphemerisData } from '../../core/ephemerisTypes';
import { positionAt, velocityAt } from '../../core/ephemerisInterp';
import { AU } from '../../core/constants';
import type { SimEvent } from '../../sim/messages';
import type { BodyId, Vector3 } from '../../sim/types';
import { card } from '../dataCard';
import { fmtKmVec, fmtUtc } from '../data/format';
import '../data/data.css';

export interface EphemerisScreenDeps {
  readonly ephemeris: EphemerisData;
  readonly addSimListener: (cb: (e: SimEvent) => void) => void;
  readonly removeSimListener: (cb: (e: SimEvent) => void) => void;
}

export interface EphemerisScreenHandle {
  destroy(): void;
}

const BODY_IDS: readonly BodyId[] = ['sun', 'earth', 'moon', 'mars', 'venus', 'jupiter'];
const BODY_COLORS: Readonly<Record<BodyId, string>> = {
  sun: '#ffd15a',
  earth: '#4cc9e0',
  moon: '#94a1b3',
  mars: '#e0655f',
  venus: '#e0b455',
  jupiter: '#a78bfa',
};

function bodyLabel(id: BodyId): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export function mountEphemerisScreen(root: HTMLElement, deps: EphemerisScreenDeps): EphemerisScreenHandle {
  root.textContent = '';
  root.classList.add('data-screen');

  let simTime = 0;

  const ephemCard = card('data-card--span-12', 'EPHEMERIS · heliocentric ecliptic J2000 (km)');
  const ephemNow = document.createElement('span');
  ephemNow.style.fontFamily = 'var(--font-mono)';
  ephemNow.style.fontSize = '10px';
  ephemNow.style.color = 'var(--text-faint)';
  ephemCard.header.appendChild(ephemNow);

  const queryForm = document.createElement('div');
  queryForm.className = 'data-query-form';
  const bodySelect = document.createElement('select');
  bodySelect.className = 'data-select';
  for (const id of BODY_IDS) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = bodyLabel(id);
    bodySelect.appendChild(opt);
  }
  bodySelect.value = 'earth';
  const dateInput = document.createElement('input');
  dateInput.className = 'data-input';
  dateInput.type = 'datetime-local';
  dateInput.style.width = '190px';
  const queryBtn = document.createElement('button');
  queryBtn.className = 'data-btn';
  queryBtn.style.width = 'auto';
  queryBtn.style.flex = '0 0 auto';
  queryBtn.style.padding = '9px 14px';
  queryBtn.textContent = 'Query';
  queryForm.append(bodySelect, dateInput, queryBtn);

  const queryResult = document.createElement('div');
  queryResult.className = 'data-query-result';
  queryResult.textContent = 'Enter a time and query a body to see its heliocentric state.';

  const ephemTableWrap = document.createElement('div');
  const ephemTable = document.createElement('table');
  ephemTable.className = 'data-table';
  ephemTable.innerHTML = `
    <thead><tr>
      <th>BODY</th><th>X</th><th>Y</th><th>Z</th><th>|r| (AU)</th>
    </tr></thead>
    <tbody></tbody>
  `;
  ephemTableWrap.appendChild(ephemTable);

  ephemCard.body.remove();
  ephemCard.el.append(queryForm, queryResult, ephemTableWrap);

  function runQuery(): void {
    const body = bodySelect.value as BodyId;
    const t = dateInput.value ? Math.floor(new Date(dateInput.value).getTime() / 1000) : simTime;
    try {
      const pos = positionAt(deps.ephemeris, body, t);
      const vel = velocityAt(deps.ephemeris, body, t);
      queryResult.innerHTML =
        `<span class="label">${bodyLabel(body)} @ ${fmtUtc(t)}</span><br/>` +
        `<span class="label">position</span> ${fmtKmVec(pos)}<br/>` +
        `<span class="label">velocity</span> ${fmtKmVec(vel)} km/s`;
    } catch (err) {
      queryResult.textContent = `Out of ephemeris coverage: ${(err as Error).message}`;
    }
  }
  queryBtn.addEventListener('click', runQuery);

  function renderEphemTable(): void {
    ephemNow.textContent = `@ ${fmtUtc(simTime)}`;
    const tbody = ephemTable.querySelector('tbody')!;
    tbody.textContent = '';
    for (const id of BODY_IDS) {
      let pos: Vector3;
      try {
        pos = positionAt(deps.ephemeris, id, simTime);
      } catch {
        continue;
      }
      const r = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="data-body-dot" style="background:${BODY_COLORS[id]}"></span>${bodyLabel(id)}</td>
        <td>${(pos.x / 1000).toFixed(0)}</td>
        <td>${(pos.y / 1000).toFixed(0)}</td>
        <td>${(pos.z / 1000).toFixed(0)}</td>
        <td>${(r / AU).toFixed(4)}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  root.append(ephemCard.el);
  renderEphemTable();

  function onSimEvent(e: SimEvent): void {
    if (e.type === 'state') {
      simTime = e.simTime;
      renderEphemTable();
    }
  }
  deps.addSimListener(onSimEvent);

  return {
    destroy(): void {
      deps.removeSimListener(onSimEvent);
      root.textContent = '';
      root.classList.remove('data-screen');
    },
  };
}

// Measurement log screen (split out of Data — mvp0_spec.md §7.5 — promoted to
// a first-level nav screen so the append-only log isn't buried inside Data's
// 12-col grid). Renders the shared MeasurementMirror instance created once in
// main.ts and fed by sim events there (src/ui/data/measurementMirror.ts) —
// this screen only subscribes and renders, it never owns the mirror.
import type { SimCommand } from '../../sim/messages';
import type { Measurement } from '../../sim/types';
import type { MeasurementMirror } from '../data/measurementMirror';
import { card } from '../dataCard';
import { fmtDegrees, fmtKm, fmtMet, fmtUtc, fmtVec } from '../data/format';
import '../data/data.css';

export interface MeasurementLogScreenDeps {
  readonly mirror: MeasurementMirror;
  readonly send: (cmd: SimCommand) => void;
  /** Epoch (unix seconds) of the current run, for MET display — set on the sim's `ready` event. */
  readonly simEpoch: () => number;
  readonly exportText?: (filename: string, text: string) => void;
}

export interface MeasurementLogScreenHandle {
  destroy(): void;
}

function bodyLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function defaultExportText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function measurementReadout(m: Measurement): string {
  switch (m.data.kind) {
    case 'radioLock':
      return `range ${fmtKm(m.data.rangeMeters)} · dir ${fmtVec(m.data.direction, 2)}`;
    case 'sunDirection':
      return `dir ${fmtVec(m.data.direction, 3)}`;
    case 'starAttitude':
      return `forward ${fmtVec(m.data.forward, 3)}`;
    case 'angularSeparation':
      return `${bodyLabel(m.data.bodyA)} ↔ ${bodyLabel(m.data.bodyB)} = ${fmtDegrees(m.data.radians)}`;
    default:
      return '';
  }
}

export function mountMeasurementLogScreen(
  root: HTMLElement,
  deps: MeasurementLogScreenDeps,
): MeasurementLogScreenHandle {
  root.textContent = '';
  root.classList.add('data-screen');

  const logCard = card('data-card--span-12', 'MEASUREMENT LOG · append-only · this run');
  const exportBtn = document.createElement('button');
  exportBtn.className = 'data-log-export';
  exportBtn.textContent = '↓ export as text';
  logCard.header.appendChild(exportBtn);
  const logTableWrap = document.createElement('div');
  const logTable = document.createElement('table');
  logTable.className = 'data-table';
  logTable.innerHTML = `
    <thead><tr>
      <th>MET / UTC</th><th>TYPE</th><th>READOUT</th><th>NOTE</th>
    </tr></thead>
    <tbody></tbody>
  `;
  logTableWrap.appendChild(logTable);
  logCard.body.remove();
  logCard.el.appendChild(logTableWrap);

  function exportLogText(): string {
    const lines = deps.mirror.all().map((m) => {
      const note = m.note ? ` — ${m.note}` : '';
      return `${fmtUtc(m.simTime)}\t${m.data.kind}\t${measurementReadout(m)}${note}`;
    });
    return lines.join('\n');
  }

  exportBtn.addEventListener('click', () => {
    const text = exportLogText();
    const exportFn = deps.exportText ?? defaultExportText;
    exportFn('measurement-log.txt', text);
  });

  function renderLog(): void {
    const tbody = logTable.querySelector('tbody')!;
    tbody.textContent = '';
    for (const m of deps.mirror.all()) {
      const tr = document.createElement('tr');
      const noteCell = document.createElement('td');
      const noteInput = document.createElement('input');
      noteInput.className = 'data-log-note-input';
      noteInput.value = m.note ?? '';
      noteInput.placeholder = 'add note…';
      noteInput.addEventListener('change', () => {
        deps.send({ type: 'annotateMeasurement', id: m.id, note: noteInput.value });
        deps.mirror.annotate(m.id, noteInput.value);
      });
      noteCell.appendChild(noteInput);

      const tagCell = document.createElement('td');
      const tag = document.createElement('span');
      tag.className = 'data-log-tag';
      tag.textContent = m.data.kind;
      tagCell.appendChild(tag);

      tr.innerHTML = `<td>${fmtUtc(m.simTime)} · ${fmtMet(m.simTime - deps.simEpoch())}</td>`;
      const readoutCell = document.createElement('td');
      readoutCell.textContent = measurementReadout(m);
      tr.append(tagCell, readoutCell, noteCell);
      tbody.appendChild(tr);
    }
  }

  root.append(logCard.el);
  renderLog();
  const unsubscribe = deps.mirror.subscribe(renderLog);

  return {
    destroy(): void {
      unsubscribe();
      root.textContent = '';
      root.classList.remove('data-screen');
    },
  };
}

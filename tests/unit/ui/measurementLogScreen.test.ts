// Measurement log screen mount (src/ui/measurementLog/index.ts) — split out
// of Data (mvp0_spec.md §7.5). happy-dom; renders a MeasurementMirror
// directly (src/ui/data/measurementMirror.ts), matching how main.ts wires it
// (one shared mirror instance fed by sim events, this screen only renders).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  mountMeasurementLogScreen,
  type MeasurementLogScreenHandle,
} from '../../../src/ui/measurementLog/index';
import { createMeasurementMirror, type MeasurementMirror } from '../../../src/ui/data/measurementMirror';
import type { SimCommand } from '../../../src/sim/messages';

const T0 = 1_800_000_000;

interface Harness {
  root: HTMLElement;
  handle: MeasurementLogScreenHandle;
  mirror: MeasurementMirror;
  sent: SimCommand[];
  exportedText: { filename: string; text: string }[];
}

function setup(): Harness {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const mirror = createMeasurementMirror();
  const sent: SimCommand[] = [];
  const exportedText: { filename: string; text: string }[] = [];
  const handle = mountMeasurementLogScreen(root, {
    mirror,
    send: (cmd) => sent.push(cmd),
    simEpoch: () => T0,
    exportText: (filename, text) => exportedText.push({ filename, text }),
  });
  return { root, handle, mirror, sent, exportedText };
}

describe('mountMeasurementLogScreen', () => {
  let h: Harness;
  beforeEach(() => {
    h = setup();
  });

  it('renders the measurement log card', () => {
    const title = h.root.querySelector('.data-card-title');
    expect(title?.textContent).toMatch(/MEASUREMENT LOG/);
  });

  it('mirror updates re-render the table; note edits send annotateMeasurement', () => {
    h.mirror.add({
      id: 5,
      simTime: T0 + 50,
      data: { kind: 'sunDirection', direction: { x: 1, y: 0, z: 0 } },
    });
    expect(h.root.querySelectorAll('tbody tr').length).toBe(1);

    const noteInput = h.root.querySelector('.data-log-note-input') as HTMLInputElement;
    noteInput.value = 'first fix';
    noteInput.dispatchEvent(new Event('change'));
    expect(h.sent).toContainEqual({ type: 'annotateMeasurement', id: 5, note: 'first fix' });

    const exportBtn = [...h.root.querySelectorAll('button')].find((b) => b.textContent?.includes('export'))!;
    exportBtn.click();
    expect(h.exportedText.length).toBe(1);
    expect(h.exportedText[0]!.text).toMatch(/sunDirection/);
    expect(h.exportedText[0]!.text).toMatch(/first fix/);
  });

  it('clears the table when the mirror clears', () => {
    h.mirror.add({ id: 1, simTime: T0, data: { kind: 'sunDirection', direction: { x: 1, y: 0, z: 0 } } });
    expect(h.root.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    h.mirror.clear();
    expect(h.root.querySelectorAll('tbody tr').length).toBe(0);
  });

  it('destroy() unsubscribes from the mirror and clears the DOM', () => {
    h.handle.destroy();
    expect(h.root.innerHTML).toBe('');
    expect(() =>
      h.mirror.add({ id: 2, simTime: T0, data: { kind: 'sunDirection', direction: { x: 1, y: 0, z: 0 } } }),
    ).not.toThrow();
  });
});

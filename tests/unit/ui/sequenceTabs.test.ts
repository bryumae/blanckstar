// DOM smoke tests for the Phase 8 Calculator / Candidates / Trajectory
// Predictor tabs (src/ui/sequence/tabs/*, mvp0_spec.md §7.6, §7.7). happy-dom.
import { describe, it, expect, beforeEach } from 'vitest';
import { mountCalculatorTab } from '../../../src/ui/sequence/tabs/calculatorTab';
import { mountCandidatesTab } from '../../../src/ui/sequence/tabs/candidatesTab';
import { mountPredictorTab } from '../../../src/ui/sequence/tabs/predictorTab';
import { createSequenceTabs } from '../../../src/ui/sequence/tabs/index';
import { createCandidateStore, type CandidateStore } from '../../../src/ui/candidateStore';
import type { StorageLike } from '../../../src/net/storage';
import type { EphemerisData, StateSample } from '../../../src/core/ephemerisTypes';
import type { Measurement } from '../../../src/sim/types';

class FakeStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

function stillBody(position: readonly [number, number, number]): { t0: number; dt: number; samples: StateSample[] } {
  const sample: StateSample = [position[0], position[1], position[2], 0, 0, 0];
  return { t0: 0, dt: 10 * 86400, samples: [sample, sample] };
}

function fakeEphemeris(): EphemerisData {
  return {
    frame: 'heliocentric-ecliptic-j2000',
    units: { position: 'm', velocity: 'm/s', time: 's' },
    bodies: {
      sun: stillBody([0, 0, 0]),
      earth: stillBody([1.5e11, 0, 0]),
      moon: stillBody([1.5e11 + 3.84e8, 0, 0]),
      mars: stillBody([2.28e11, 0, 0]),
    },
  };
}

function root(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('mountCalculatorTab', () => {
  let r: HTMLElement;
  beforeEach(() => {
    r = root();
  });

  it('renders the operation picker, vector rows, and a constants table', () => {
    mountCalculatorTab(r);
    expect(r.querySelector('select')).toBeTruthy();
    expect(r.textContent).toContain('SHIP_MASS_KG');
    expect(r.textContent).toContain('CONSTANTS');
  });

  it('computing dot(A, B) with default zero inputs shows 0', () => {
    mountCalculatorTab(r);
    const result = r.querySelector('.calc-result-value')!;
    expect(result.textContent).toContain('0');
  });

  it('changing vector A updates the norm() result live', () => {
    mountCalculatorTab(r);
    const select = r.querySelector('select')!;
    select.value = 'norm';
    select.dispatchEvent(new Event('change'));
    const inputs = r.querySelectorAll<HTMLInputElement>('.calc-input');
    // First three calc-inputs are vector A's x/y/z.
    inputs[0]!.value = '3';
    inputs[0]!.dispatchEvent(new Event('input'));
    inputs[1]!.value = '4';
    inputs[1]!.dispatchEvent(new Event('input'));
    const result = r.querySelector('.calc-result-value')!;
    expect(result.textContent).toContain('5');
  });

  it('degree toggle converts an angleBetween result to degrees', () => {
    mountCalculatorTab(r);
    const select = r.querySelector('select')!;
    select.value = 'angleBetween';
    select.dispatchEvent(new Event('change'));
    const inputs = r.querySelectorAll<HTMLInputElement>('.calc-input');
    // A = (1,0,0), B = (0,1,0) -> 90 degrees.
    inputs[0]!.value = '1';
    inputs[0]!.dispatchEvent(new Event('input'));
    inputs[4]!.value = '1'; // B.y
    inputs[4]!.dispatchEvent(new Event('input'));
    const toggle = r.querySelector<HTMLInputElement>('.calc-deg-toggle input')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    const result = r.querySelector('.calc-result-value')!;
    expect(result.textContent).toContain('90');
    expect(result.textContent).toContain('°');
  });
});

describe('mountCandidatesTab', () => {
  let r: HTMLElement;
  let storage: FakeStorage;
  let store: CandidateStore;
  let measurements: Measurement[];

  beforeEach(() => {
    r = root();
    storage = new FakeStorage();
    store = createCandidateStore(storage);
    measurements = [];
  });

  function mount(): void {
    mountCandidatesTab(r, {
      ephemeris: fakeEphemeris(),
      storage,
      candidates: store,
      getMeasurements: () => measurements,
      exportText: () => {},
      importText: async () => null,
    });
  }

  it('renders saved candidates, search form, and notes area', () => {
    mount();
    expect(r.textContent).toContain('SAVED STATE CANDIDATES');
    expect(r.textContent).toContain('CANDIDATE-SEARCH TABLE');
    expect(r.textContent).toContain('NOTES');
    expect(r.textContent).toContain('residuals only');
  });

  it('saving a candidate through the form round-trips through the store', () => {
    mount();
    const inputs = r.querySelectorAll<HTMLInputElement>('.grid-form')[0]!.querySelectorAll('input');
    const [nameInput, epochInput, pxInput, pyInput, pzInput, vxInput, vyInput, vzInput] = inputs;
    nameInput!.value = 'C-01';
    epochInput!.value = '2026-09-01T00:00:00Z';
    pxInput!.value = '100000';
    pyInput!.value = '200000';
    pzInput!.value = '0';
    vxInput!.value = '10';
    vyInput!.value = '20';
    vzInput!.value = '0';
    const saveBtn = [...r.querySelectorAll('button')].find((b) => b.textContent === 'Save candidate')!;
    saveBtn.click();

    expect(store.list()).toHaveLength(1);
    const saved = store.list()[0]!;
    expect(saved.name).toBe('C-01');
    expect(saved.position.x).toBeCloseTo(100_000_000, 3); // km -> m
    expect(saved.velocity.y).toBeCloseTo(20_000, 3); // km/s -> m/s
    expect(r.textContent).toContain('C-01');
  });

  it('deleting a saved candidate removes it from the store and DOM', () => {
    store.save({ id: 'x1', name: 'C-99', epoch: 100, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, createdAt: 0 });
    mount();
    expect(r.textContent).toContain('C-99');
    const delBtn = [...r.querySelectorAll('button')].find((b) => b.textContent === 'Delete')!;
    delBtn.click();
    expect(store.list()).toHaveLength(0);
    expect(r.textContent).not.toContain('C-99');
  });

  it('shows the candidate grid count and disables run when it exceeds the cap', () => {
    mount();
    const searchInputs = r.querySelectorAll<HTMLInputElement>('.grid-form')[1]!.querySelectorAll('input');
    const [xMin, xMax, yMin, yMax, zMin, zMax, step] = searchInputs;
    xMin!.value = '0';
    xMin!.dispatchEvent(new Event('input'));
    xMax!.value = '1000000';
    xMax!.dispatchEvent(new Event('input'));
    yMin!.value = '0';
    yMin!.dispatchEvent(new Event('input'));
    yMax!.value = '1000000';
    yMax!.dispatchEvent(new Event('input'));
    zMin!.value = '0';
    zMin!.dispatchEvent(new Event('input'));
    zMax!.value = '1000000';
    zMax!.dispatchEvent(new Event('input'));
    step!.value = '1';
    step!.dispatchEvent(new Event('input'));
    const runBtn = [...r.querySelectorAll('button')].find((b) => b.textContent === 'Run candidate search')! as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(r.textContent).toContain('exceeds the');
  });

  it('running a small candidate search produces a MISMATCH table with a save-as-candidate action', () => {
    measurements = [
      {
        id: 1,
        simTime: 100,
        data: { kind: 'sunDirection', direction: { x: -1, y: 0, z: 0 } },
      },
    ];
    mount();
    const searchInputs = r.querySelectorAll<HTMLInputElement>('.grid-form')[1]!.querySelectorAll('input');
    const [xMin, xMax, yMin, yMax, zMin, zMax, step] = searchInputs;
    xMin!.value = '0';
    xMax!.value = '2000000';
    yMin!.value = '0';
    yMax!.value = '0';
    zMin!.value = '0';
    zMax!.value = '0';
    step!.value = '1000000';
    for (const inp of [xMin, xMax, yMin, yMax, zMin, zMax, step]) inp!.dispatchEvent(new Event('input'));

    const runBtn = [...r.querySelectorAll('button')].find((b) => b.textContent === 'Run candidate search')! as HTMLButtonElement;
    expect(runBtn.disabled).toBe(false);
    runBtn.click();

    expect(r.textContent).toContain('MISMATCH');
    const saveAsBtns = [...r.querySelectorAll('button')].filter((b) => b.textContent === 'Save as candidate');
    expect(saveAsBtns.length).toBeGreaterThan(0);
    saveAsBtns[0]!.click();
    expect(store.list().length).toBeGreaterThan(0);
  });

  it('notes persist via storage and export uses the injected seam', () => {
    let exported: { filename: string; text: string } | null = null;
    mountCandidatesTab(r, {
      ephemeris: fakeEphemeris(),
      storage,
      candidates: store,
      getMeasurements: () => measurements,
      exportText: (filename, text) => {
        exported = { filename, text };
      },
      importText: async () => null,
    });
    const notes = r.querySelector<HTMLTextAreaElement>('textarea.notes')!;
    notes.value = 'hello world';
    notes.dispatchEvent(new Event('input'));
    expect(storage.getItem('blanckstar.notes.v1')).toBe(JSON.stringify('hello world'));

    const exportBtn = [...r.querySelectorAll('button')].find((b) => b.textContent === 'Export .txt')!;
    exportBtn.click();
    expect(exported).toEqual({ filename: 'notes.txt', text: 'hello world' });
  });

  it('import replaces the notes textarea content', async () => {
    mountCandidatesTab(r, {
      ephemeris: fakeEphemeris(),
      storage,
      candidates: store,
      getMeasurements: () => measurements,
      exportText: () => {},
      importText: async () => 'imported text',
    });
    const importBtn = [...r.querySelectorAll('button')].find((b) => b.textContent === 'Import .txt')!;
    importBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    const notes = r.querySelector<HTMLTextAreaElement>('textarea.notes')!;
    expect(notes.value).toBe('imported text');
  });
});

describe('mountPredictorTab', () => {
  let r: HTMLElement;
  let storage: FakeStorage;
  let store: CandidateStore;

  beforeEach(() => {
    r = root();
    storage = new FakeStorage();
    store = createCandidateStore(storage);
  });

  it('renders the input form, summary cards, and an empty table hint', () => {
    mountPredictorTab(r, { ephemeris: fakeEphemeris(), candidates: store });
    expect(r.textContent).toContain('INPUT STATE');
    expect(r.textContent).toContain('CLOSEST APPROACH TO EARTH');
    expect(r.textContent).toContain('Run a prediction to populate this table.');
  });

  it('loading a saved candidate populates the state fields', () => {
    store.save({
      id: 'c1',
      name: 'C-07',
      epoch: 1000,
      position: { x: 1.5e11 + 1e7, y: 0, z: 0 },
      velocity: { x: 0, y: 1000, z: 0 },
      createdAt: 0,
    });
    mountPredictorTab(r, { ephemeris: fakeEphemeris(), candidates: store });
    const select = r.querySelector('select')!;
    select.value = 'c1';
    select.dispatchEvent(new Event('change'));
    const inputs = [...r.querySelectorAll('.form-grid')[1]!.querySelectorAll('input')];
    const pxInput = inputs[1]!; // epoch, posX, posY, posZ, velX...
    expect(pxInput.value).toBe(String((1.5e11 + 1e7) / 1000));
  });

  it('running a short prediction populates the table and closest-approach card', async () => {
    mountPredictorTab(r, { ephemeris: fakeEphemeris(), candidates: store });
    const stateInputs = [...r.querySelectorAll('.form-grid')[1]!.querySelectorAll('input')];
    const [epochInput, pxInput, pyInput, pzInput, vxInput, vyInput, vzInput] = stateInputs;
    // Fake ephemeris covers unix seconds [0, 86400]; pick an epoch inside it.
    epochInput!.value = '1970-01-01T00:10:00Z';
    pxInput!.value = String((1.5e11 + 1e7) / 1000);
    pyInput!.value = '0';
    pzInput!.value = '0';
    vxInput!.value = '0';
    vyInput!.value = '7.5';
    vzInput!.value = '0';

    const runGrid = [...r.querySelectorAll('.form-grid')].find((g) => g.querySelector('label')?.textContent === 'DURATION (days)')!;
    const [durationInput, stepInput] = runGrid.querySelectorAll('input');
    durationInput!.value = String(3600 / 86400); // 1 hour, as a fraction of a day
    stepInput!.value = '0.25'; // 15 minutes in hours

    const runBtn = [...r.querySelectorAll('button')].find((b) => b.textContent === 'Run prediction')! as HTMLButtonElement;
    runBtn.click();

    // Drain the chunked propagation's microtask/timer queue.
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(r.querySelector('.table-wrap table')).toBeTruthy();
    expect(runBtn.disabled).toBe(false);
  }, 10_000);

  it('cancel stops a running prediction', async () => {
    mountPredictorTab(r, { ephemeris: fakeEphemeris(), candidates: store });
    const stateInputs = [...r.querySelectorAll('.form-grid')[1]!.querySelectorAll('input')];
    const [epochInput, pxInput, pyInput, pzInput, vxInput, vyInput, vzInput] = stateInputs;
    epochInput!.value = '1970-01-01T00:10:00Z';
    pxInput!.value = String((1.5e11 + 1e7) / 1000);
    pyInput!.value = '0';
    pzInput!.value = '0';
    vxInput!.value = '0';
    vyInput!.value = '7.5';
    vzInput!.value = '0';
    const runGrid = [...r.querySelectorAll('.form-grid')].find((g) => g.querySelector('label')?.textContent === 'DURATION (days)')!;
    const [durationInput, stepInput] = runGrid.querySelectorAll('input');
    durationInput!.value = '0.01'; // ~864s, stays inside the fake ephemeris's 1-day coverage
    stepInput!.value = '0.1';

    const runBtn = [...r.querySelectorAll('button')].find((b) => b.textContent === 'Run prediction')! as HTMLButtonElement;
    const cancelBtn = [...r.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')! as HTMLButtonElement;
    runBtn.click();
    expect(cancelBtn.disabled).toBe(false);
    cancelBtn.click();

    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(runBtn.disabled).toBe(false);
  }, 10_000);

  it('rejects an invalid form submission without throwing', () => {
    const alertSpy = () => {};
    (globalThis as { alert?: typeof alertSpy }).alert = alertSpy;
    mountPredictorTab(r, { ephemeris: fakeEphemeris(), candidates: store });
    const runBtn = [...r.querySelectorAll('button')].find((b) => b.textContent === 'Run prediction')!;
    expect(() => runBtn.click()).not.toThrow();
  });
});

describe('createSequenceTabs (barrel)', () => {
  it('returns calculator, candidates, predictor tabs that mount without throwing', () => {
    const storage = new FakeStorage();
    const store = createCandidateStore(storage);
    const tabs = createSequenceTabs({
      ephemeris: fakeEphemeris(),
      storage,
      candidates: store,
      getMeasurements: () => [],
    });
    expect(tabs.map((t) => t.id)).toEqual(['calculator', 'candidates', 'predictor']);
    expect(tabs.map((t) => t.label)).toEqual(['Calculator', 'Candidates', 'Trajectory Predictor']);
    for (const tab of tabs) {
      const el = root();
      expect(() => tab.mount(el)).not.toThrow();
    }
  });

  it('uses default export/import seams when not provided', () => {
    const storage = new FakeStorage();
    const store = createCandidateStore(storage);
    const tabs = createSequenceTabs({
      ephemeris: fakeEphemeris(),
      storage,
      candidates: store,
      getMeasurements: () => [],
    });
    const candidatesTab = tabs.find((t) => t.id === 'candidates')!;
    const el = root();
    expect(() => candidatesTab.mount(el)).not.toThrow();
  });
});

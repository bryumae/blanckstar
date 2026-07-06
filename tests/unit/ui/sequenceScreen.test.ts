// Script Console code-sheet workspace (src/ui/sequence/index.ts, mvp0_spec.md
// §7.9). happy-dom; the console controller is a fake.
import { describe, it, expect, beforeEach } from 'vitest';
import { mountSequenceScreen, type ScriptConsoleController, type ConsoleSink } from '../../../src/ui/sequence/index';
import type { StorageLike } from '../../../src/net/storage';
import { FORBIDDEN_API_NAMES } from '../../../src/sandbox/apiDocs';

class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

function fakeController(): ScriptConsoleController & { runs: string[]; stops: number; running: boolean } {
  return {
    runs: [],
    stops: 0,
    running: false,
    run(source: string) {
      this.runs.push(source);
      this.running = true;
    },
    stop() {
      this.stops += 1;
      this.running = false;
    },
    isRunning() {
      return this.running;
    },
  };
}

function mountWithSink(root: HTMLElement, storage = new FakeStorage(), controller = fakeController()) {
  let sink: ConsoleSink | null = null;
  const handle = mountSequenceScreen(root, {
    storage,
    console: controller,
    bindConsole: (s) => {
      sink = s;
    },
  });
  return { storage, controller, sink: sink!, handle };
}

describe('mountSequenceScreen', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  it('renders code-sheet tabs and no feature mode tab bar', () => {
    mountWithSink(root);
    expect(root.querySelectorAll('.sequence-tab')).toHaveLength(0);
    expect(root.querySelector('.sheet-tab.is-active')!.textContent).toContain('sequence.js');
    expect([...root.querySelectorAll('.script-list-item.seeded .name')].map((e) => e.textContent)).toEqual([
      'Calculator',
      'Candidates',
      'Trajectory Predictor',
    ]);
  });

  it('opens seeded Calculator, Candidates, and Trajectory Predictor sheets from the rail', () => {
    mountWithSink(root);
    for (const [label, match] of [
      ['Calculator', /calculator/i],
      ['Candidates', /candidates/i],
      ['Trajectory Predictor', /trajectory/i],
    ] as const) {
      [...root.querySelectorAll('.script-list-item')].find((e) => e.textContent === label)!.dispatchEvent(new Event('click'));
      expect(root.querySelector('.sheet-tab.is-active')!.textContent).toMatch(match);
    }
    expect([...root.querySelectorAll('.sheet-tab span:first-child')].map((e) => e.textContent)).toEqual([
      'sequence.js',
      'calculator.js',
      'candidates.js',
      'trajectory-predictor.js',
    ]);
  });

  it('multiple sheets preserve separate editor content and output while switching', () => {
    const { sink } = mountWithSink(root);
    const textarea = root.querySelector('.script-textarea') as HTMLTextAreaElement;
    textarea.value = 'log("user")';
    textarea.dispatchEvent(new Event('input'));
    sink.appendLine('log', 'user output');

    [...root.querySelectorAll('.script-list-item')].find((e) => e.textContent === 'Calculator')!.dispatchEvent(new Event('click'));
    textarea.value = 'log("calc")';
    textarea.dispatchEvent(new Event('input'));
    sink.appendLine('log', 'calc output');
    expect(root.querySelector('.script-console-lines')!.textContent).toContain('calc output');

    (root.querySelector('.sheet-tab[data-sheet^="script:"]') as HTMLButtonElement).click();
    expect(textarea.value).toBe('log("user")');
    expect(root.querySelector('.script-console-lines')!.textContent).toContain('user output');

    (root.querySelector('.sheet-tab[data-sheet="seed:calculator"]') as HTMLButtonElement).click();
    expect(textarea.value).toBe('log("calc")');
    expect(root.querySelector('.script-console-lines')!.textContent).toContain('calc output');
  });

  it('Run passes the active sheet source and bridge output lands on that sheet', () => {
    const controller = fakeController();
    const { sink } = mountWithSink(root, new FakeStorage(), controller);
    [...root.querySelectorAll('.script-list-item')].find((e) => e.textContent === 'Calculator')!.dispatchEvent(new Event('click'));
    const textarea = root.querySelector('.script-textarea') as HTMLTextAreaElement;
    textarea.value = 'log(123)';
    textarea.dispatchEvent(new Event('input'));
    (root.querySelector('.script-btn.run') as HTMLButtonElement).click();
    expect(controller.runs).toEqual(['log(123)']);
    sink.appendLine('log', 'ran calculator');
    sink.setRunning(false);
    (root.querySelector('.sheet-tab[data-sheet^="script:"]') as HTMLButtonElement).click();
    sink.appendLine('ok', 'script finished');

    expect(root.querySelector('.script-console-lines')!.textContent).not.toContain('ran calculator');
    expect(root.querySelector('.script-console-lines')!.textContent).not.toContain('script finished');
    (root.querySelector('.sheet-tab[data-sheet="seed:calculator"]') as HTMLButtonElement).click();
    expect(root.querySelector('.script-console-lines')!.textContent).toContain('ran calculator');
    expect(root.querySelector('.script-console-lines')!.textContent).toContain('script finished');
  });

  it('Stop calls the controller after the bridge reports running', () => {
    const controller = fakeController();
    const { sink } = mountWithSink(root, new FakeStorage(), controller);
    (root.querySelector('.script-btn.run') as HTMLButtonElement).click();
    sink.setRunning(true);
    const stopBtn = root.querySelector('.script-btn.stop') as HTMLButtonElement;
    expect(stopBtn.disabled).toBe(false);
    stopBtn.click();
    expect(controller.stops).toBe(1);
  });

  it('creating and deleting user scripts updates the rail', () => {
    mountWithSink(root);
    const before = root.querySelectorAll('.script-list-item:not(.seeded)').length;
    (root.querySelector('.script-list-header .del') as HTMLButtonElement).click();
    expect(root.querySelectorAll('.script-list-item:not(.seeded)').length).toBe(before + 1);
    const delBtns = root.querySelectorAll('.script-list-item:not(.seeded) .del');
    (delBtns[delBtns.length - 1] as HTMLButtonElement).click();
    expect(root.querySelectorAll('.script-list-item:not(.seeded)').length).toBe(before);
  });

  it('open tabs, active tab, editor output, and split restore from storage', () => {
    const storage = new FakeStorage();
    const { sink, handle } = mountWithSink(root, storage);
    [...root.querySelectorAll('.script-list-item')].find((e) => e.textContent === 'Calculator')!.dispatchEvent(new Event('click'));
    const textarea = root.querySelector('.script-textarea') as HTMLTextAreaElement;
    textarea.value = 'log("persisted")';
    textarea.dispatchEvent(new Event('input'));
    sink.appendLine('log', 'persisted output');
    const body = root.querySelector('.script-workspace-body') as HTMLElement;
    body.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 400, right: 1000, bottom: 400, x: 0, y: 0, toJSON: () => '' });
    (root.querySelector('.script-splitter') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { clientY: 200 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientY: 288 }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    handle.destroy();

    const root2 = document.createElement('div');
    mountWithSink(root2, storage);
    expect(root2.querySelector('.sheet-tab.is-active')!.textContent).toContain('calculator.js');
    expect((root2.querySelector('.script-textarea') as HTMLTextAreaElement).value).toBe('log("persisted")');
    // Restored sheets start on the drawers (issue #30); history is a click away.
    expect((root2.querySelector('.script-console-output-view') as HTMLElement).hidden).toBe(true);
    (root2.querySelector('.api-ref-show-output') as HTMLButtonElement).click();
    expect(root2.querySelector('.script-console-lines')!.textContent).toContain('persisted output');
    expect((root2.querySelector('.script-editor-col') as HTMLElement).style.flexBasis).toBe('72.00%');
  });

  it('splitter drag clamps and persists the editor ratio', () => {
    const storage = new FakeStorage();
    const { handle } = mountWithSink(root, storage);
    const body = root.querySelector('.script-workspace-body') as HTMLElement;
    body.getBoundingClientRect = () => ({ left: 100, top: 50, width: 1000, height: 400, right: 1100, bottom: 450, x: 100, y: 50, toJSON: () => '' });
    (root.querySelector('.script-splitter') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { clientY: 200 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientY: 390 }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect((root.querySelector('.script-editor-col') as HTMLElement).style.flexBasis).toBe('75.00%');
    handle.destroy();

    const root2 = document.createElement('div');
    mountWithSink(root2, storage);
    expect((root2.querySelector('.script-editor-col') as HTMLElement).style.flexBasis).toBe('75.00%');
  });

  it('shows the API reference drawers on a fresh sheet with no output', () => {
    mountWithSink(root);
    expect((root.querySelector('.script-console-output-view') as HTMLElement).hidden).toBe(true);
    expect((root.querySelector('.script-api-reference') as HTMLElement).hidden).toBe(false);
    // No history yet — no "Show last output" affordance.
    expect((root.querySelector('.api-ref-show-output') as HTMLButtonElement).hidden).toBe(true);
    const titles = [...root.querySelectorAll('.api-ref-drawer-title')].map((e) => e.textContent);
    expect(titles).toEqual(['Variables & constants', 'Functions']);
  });

  it('Run opens the output pane; close returns to drawers with history kept', () => {
    const { sink } = mountWithSink(root);
    (root.querySelector('.script-btn.run') as HTMLButtonElement).click();
    expect((root.querySelector('.script-console-output-view') as HTMLElement).hidden).toBe(false);
    sink.appendLine('log', 'run line');
    expect(root.querySelector('.script-console-lines')!.textContent).toContain('run line');

    (root.querySelector('.script-console-close') as HTMLButtonElement).click();
    expect((root.querySelector('.script-console-output-view') as HTMLElement).hidden).toBe(true);
    expect((root.querySelector('.script-api-reference') as HTMLElement).hidden).toBe(false);
    expect((root.querySelector('.api-ref-show-output') as HTMLButtonElement).hidden).toBe(false);

    (root.querySelector('.api-ref-show-output') as HTMLButtonElement).click();
    expect((root.querySelector('.script-console-output-view') as HTMLElement).hidden).toBe(false);
    expect(root.querySelector('.script-console-lines')!.textContent).toContain('run line');
  });

  it('a run on a background sheet leaves the active sheet drawers in place', () => {
    const controller = fakeController();
    const { sink } = mountWithSink(root, new FakeStorage(), controller);
    (root.querySelector('.script-btn.run') as HTMLButtonElement).click();
    [...root.querySelectorAll('.script-list-item')].find((e) => e.textContent === 'Calculator')!.dispatchEvent(new Event('click'));
    expect((root.querySelector('.script-api-reference') as HTMLElement).hidden).toBe(false);

    sink.appendLine('log', 'background line');
    // Active (Calculator) sheet keeps its drawers...
    expect((root.querySelector('.script-api-reference') as HTMLElement).hidden).toBe(false);
    // ...while the running sheet's output (opened at Run) collected the line.
    (root.querySelector('.sheet-tab[data-sheet^="script:"]') as HTMLButtonElement).click();
    expect((root.querySelector('.script-console-output-view') as HTMLElement).hidden).toBe(false);
    expect(root.querySelector('.script-console-lines')!.textContent).toContain('background line');
  });

  it('a mid-run close sticks against subsequent output lines', () => {
    const { sink } = mountWithSink(root);
    (root.querySelector('.script-btn.run') as HTMLButtonElement).click();
    sink.appendLine('log', 'first line');
    (root.querySelector('.script-console-close') as HTMLButtonElement).click();
    sink.appendLine('log', 'second line');
    expect((root.querySelector('.script-console-output-view') as HTMLElement).hidden).toBe(true);
    // History still accumulated while closed.
    (root.querySelector('.api-ref-show-output') as HTMLButtonElement).click();
    expect(root.querySelector('.script-console-lines')!.textContent).toContain('second line');
  });

  it('output from a live run auto-opens after a remount restored the drawers', () => {
    const storage = new FakeStorage();
    const controller = fakeController();
    const first = mountWithSink(root, storage, controller);
    (root.querySelector('.script-btn.run') as HTMLButtonElement).click();
    first.handle.destroy();

    // Remount while the worker is still running: sheets restore to drawers.
    const root2 = document.createElement('div');
    const second = mountWithSink(root2, storage, controller);
    expect((root2.querySelector('.script-console-output-view') as HTMLElement).hidden).toBe(true);
    second.sink.appendLine('log', 'still running');
    expect((root2.querySelector('.script-console-output-view') as HTMLElement).hidden).toBe(false);
    expect(root2.querySelector('.script-console-lines')!.textContent).toContain('still running');
  });

  it('post-run event lines never steal the active sheet drawers', () => {
    const controller = fakeController();
    const { sink } = mountWithSink(root, new FakeStorage(), controller);
    (root.querySelector('.script-btn.run') as HTMLButtonElement).click();
    controller.running = false;
    sink.appendLine('ok', 'script finished'); // clears the running sheet
    [...root.querySelectorAll('.script-list-item')].find((e) => e.textContent === 'Calculator')!.dispatchEvent(new Event('click'));
    expect((root.querySelector('.script-api-reference') as HTMLElement).hidden).toBe(false);

    sink.appendLine('event', 'burn started');
    expect((root.querySelector('.script-api-reference') as HTMLElement).hidden).toBe(false);
    // The line is still recorded for later inspection.
    (root.querySelector('.api-ref-show-output') as HTMLButtonElement).click();
    expect(root.querySelector('.script-console-lines')!.textContent).toContain('burn started');
  });

  it('errors and an unresponsive worker force the output open past a close', () => {
    const { sink } = mountWithSink(root);
    (root.querySelector('.script-btn.run') as HTMLButtonElement).click();
    (root.querySelector('.script-console-close') as HTMLButtonElement).click();
    sink.setUnresponsive(true);
    expect((root.querySelector('.script-console-output-view') as HTMLElement).hidden).toBe(false);

    (root.querySelector('.script-console-close') as HTMLButtonElement).click();
    sink.setError('boom', 3);
    expect((root.querySelector('.script-console-output-view') as HTMLElement).hidden).toBe(false);
    expect(root.querySelector('.script-console-lines')!.textContent).toContain('boom (line 3)');
  });

  it('the shared filter narrows both drawers and shows per-drawer empty states', () => {
    mountWithSink(root);
    const filter = root.querySelector('.api-ref-filter') as HTMLInputElement;
    filter.value = 'burn';
    filter.dispatchEvent(new Event('input'));
    const names = [...root.querySelectorAll('.api-ref-name')].map((e) => e.textContent);
    expect(names.some((n) => n!.startsWith('ship.burn('))).toBe(true);
    expect(names.some((n) => n!.startsWith('vec('))).toBe(false);
    expect(root.querySelector('.api-ref-empty')!.textContent).toBe('No matching variables.');

    filter.value = 'zz-no-match';
    filter.dispatchEvent(new Event('input'));
    const empties = [...root.querySelectorAll('.api-ref-empty')].map((e) => e.textContent);
    expect(empties).toEqual(['No matching variables.', 'No matching functions.']);
  });

  it('drawer sort reorders rows in both directions without touching the other drawer', () => {
    mountWithSink(root);
    const varSort = root.querySelectorAll('.api-ref-sort')[0] as HTMLSelectElement;
    varSort.value = 'name-desc';
    varSort.dispatchEvent(new Event('change'));
    const varNames = [...root.querySelectorAll('.api-ref-drawer')[0]!.querySelectorAll('.api-ref-name')].map((e) => e.textContent);
    expect(varNames[0]).toBe('SHIP_MASS_KG');
    const fnNames = [...root.querySelectorAll('.api-ref-drawer')[1]!.querySelectorAll('.api-ref-name')].map((e) => e.textContent);
    expect(fnNames[0]!.startsWith('add(')).toBe(true);
  });

  it('never lists forbidden §8.3 names in the drawers', () => {
    mountWithSink(root);
    const text = (root.querySelector('.script-api-reference') as HTMLElement).textContent!;
    for (const forbidden of FORBIDDEN_API_NAMES) {
      // Check the bare member name too (e.g. 'truePosition'), not just the
      // dotted form — a drawer row must not mention it in any spelling.
      expect(text).not.toContain(forbidden.split('.').pop()!);
    }
    // ship.burn is documented as awaited.
    const burnRow = [...root.querySelectorAll('.api-ref-row')].find((r) =>
      r.querySelector('.api-ref-name')!.textContent!.startsWith('ship.burn('),
    )!;
    expect(burnRow.textContent).toContain('await');
  });

  it('renders a line-number gutter matching the source line count', () => {
    mountWithSink(root);
    const textarea = root.querySelector('.script-textarea') as HTMLTextAreaElement;
    textarea.value = 'a\nb\nc';
    textarea.dispatchEvent(new Event('input'));
    expect(root.querySelectorAll('.script-gutter div')).toHaveLength(3);
  });
});

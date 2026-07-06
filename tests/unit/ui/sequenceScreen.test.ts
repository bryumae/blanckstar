// Script Console code-sheet workspace (src/ui/sequence/index.ts, mvp0_spec.md
// §7.9). happy-dom; the console controller is a fake.
import { describe, it, expect, beforeEach } from 'vitest';
import { mountSequenceScreen, type ScriptConsoleController, type ConsoleSink } from '../../../src/ui/sequence/index';
import type { StorageLike } from '../../../src/net/storage';
import { FORBIDDEN_API_NAMES } from '../../../src/sandbox/apiDocs';
import type { SandboxVarEntry } from '../../../src/sandbox/vars';
import type { EditorHost } from '../../../src/ui/sequence/editorHost';

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

class FakeEditorHost implements EditorHost {
  readonly element = document.createElement('div');
  value = '';
  errorLine: number | null = null;
  focused = false;
  destroyed = false;
  private listeners = new Set<(source: string) => void>();

  constructor() {
    this.element.className = 'script-editor fake-editor';
  }

  getValue(): string {
    return this.value;
  }
  setValue(source: string): void {
    this.value = source;
  }
  onChange(cb: (source: string) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  focus(): void {
    this.focused = true;
  }
  setErrorLine(line: number | null): void {
    this.errorLine = line;
  }
  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
  }
  input(source: string): void {
    this.value = source;
    for (const listener of [...this.listeners]) listener(source);
  }
}

function mountWithSink(root: HTMLElement, storage = new FakeStorage(), controller = fakeController()) {
  let sink: ConsoleSink | null = null;
  const editor = new FakeEditorHost();
  const handle = mountSequenceScreen(root, {
    storage,
    console: controller,
    createEditorHost: () => editor,
    bindConsole: (s) => {
      sink = s;
    },
  });
  return { storage, controller, editor, sink: sink!, handle };
}

class FakeVarsStore {
  entries: SandboxVarEntry[] = [];
  descriptions: [string, string][] = [];
  deletes: string[] = [];
  private listeners: (() => void)[] = [];
  list(): readonly SandboxVarEntry[] {
    return this.entries;
  }
  setDescription(name: string, description: string): void {
    this.descriptions.push([name, description]);
    this.entries = this.entries.map((entry) =>
      entry.name === name ? { ...entry, description } : entry,
    );
    this.emit();
  }
  deleteValue(name: string): void {
    this.deletes.push(name);
    this.entries = this.entries.filter((entry) => entry.name !== name);
    this.emit();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
  emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
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
    expect(root.querySelectorAll('.sheet-topbar')).toHaveLength(1);
    expect(root.querySelectorAll('.script-editor-header')).toHaveLength(0);
    expect(root.querySelector('.sheet-topbar .script-buttons')).not.toBeNull();
    expect(root.querySelector('.sheet-tab.is-active')!.textContent).toContain('sequence.js');
    expect([...root.querySelectorAll('.script-list-item.seeded .name')].map((e) => e.textContent)).toEqual([
      'Calculator',
      'Candidates',
      'Store & recall',
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

  it('wheel-scrolls the sheet tab strip horizontally', () => {
    mountWithSink(root);
    const tabs = root.querySelector('.sheet-tabs') as HTMLElement;
    tabs.scrollLeft = 10;
    tabs.dispatchEvent(new WheelEvent('wheel', { deltaY: 75, bubbles: true, cancelable: true }));
    expect(tabs.scrollLeft).toBe(85);
  });

  it('multiple sheets preserve separate editor content and output while switching', () => {
    const { sink, editor } = mountWithSink(root);
    editor.input('log("user")');
    sink.appendLine('log', 'user output');

    [...root.querySelectorAll('.script-list-item')].find((e) => e.textContent === 'Calculator')!.dispatchEvent(new Event('click'));
    editor.input('log("calc")');
    sink.appendLine('log', 'calc output');
    expect(root.querySelector('.script-console-lines')!.textContent).toContain('calc output');

    (root.querySelector('.sheet-tab[data-sheet^="script:"]') as HTMLButtonElement).click();
    expect(editor.value).toBe('log("user")');
    expect(root.querySelector('.script-console-lines')!.textContent).toContain('user output');

    (root.querySelector('.sheet-tab[data-sheet="seed:calculator"]') as HTMLButtonElement).click();
    expect(editor.value).toBe('log("calc")');
    expect(root.querySelector('.script-console-lines')!.textContent).toContain('calc output');
  });

  it('Run passes the active sheet source and bridge output lands on that sheet', () => {
    const controller = fakeController();
    const { sink, editor } = mountWithSink(root, new FakeStorage(), controller);
    [...root.querySelectorAll('.script-list-item')].find((e) => e.textContent === 'Calculator')!.dispatchEvent(new Event('click'));
    editor.input('log(123)');
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
    const { sink, editor, handle } = mountWithSink(root, storage);
    [...root.querySelectorAll('.script-list-item')].find((e) => e.textContent === 'Calculator')!.dispatchEvent(new Event('click'));
    editor.input('log("persisted")');
    sink.appendLine('log', 'persisted output');
    const body = root.querySelector('.script-workspace-body') as HTMLElement;
    body.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 400, right: 1000, bottom: 400, x: 0, y: 0, toJSON: () => '' });
    (root.querySelector('.script-splitter') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { clientY: 200 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientY: 288, buttons: 1 }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    handle.destroy();

    const root2 = document.createElement('div');
    const second = mountWithSink(root2, storage);
    expect(root2.querySelector('.sheet-tab.is-active')!.textContent).toContain('calculator.js');
    expect(second.editor.value).toBe('log("persisted")');
    // Restored sheets start on the drawers (issue #30); history is a click away.
    expect((root2.querySelector('.script-console-output-view') as HTMLElement).hidden).toBe(true);
    (root2.querySelector('.script-btn.output') as HTMLButtonElement).click();
    expect(root2.querySelector('.script-console-lines')!.textContent).toContain('persisted output');
    expect((root2.querySelector('.script-editor-col') as HTMLElement).style.flexBasis).toBe('72.00%');
  });

  it('splitter drag clamps and persists the editor ratio', () => {
    const storage = new FakeStorage();
    const { handle } = mountWithSink(root, storage);
    const body = root.querySelector('.script-workspace-body') as HTMLElement;
    body.getBoundingClientRect = () => ({ left: 100, top: 50, width: 1000, height: 400, right: 1100, bottom: 450, x: 100, y: 50, toJSON: () => '' });
    (root.querySelector('.script-splitter') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { clientY: 200 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientY: 390, buttons: 1 }));
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
    // The header Output button is available while the drawers show.
    expect((root.querySelector('.script-btn.output') as HTMLButtonElement).disabled).toBe(false);
    // Each drawer's filter carries the drawer name as its placeholder.
    const placeholders = [...root.querySelectorAll('.api-ref-filter')].map((e) => (e as HTMLInputElement).placeholder);
    expect(placeholders).toEqual(['Variables & constants', 'Functions']);
    // The sections keep the drawer name for assistive tech — the placeholder
    // disappears once the user types.
    const labels = [...root.querySelectorAll('.api-ref-drawer')].map((e) => e.getAttribute('aria-label'));
    expect(labels).toEqual(['Variables & constants', 'Functions']);
    const drawerSplitter = root.querySelector('.api-ref-splitter')!;
    expect(drawerSplitter.getAttribute('role')).toBe('separator');
    expect(drawerSplitter.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('Run opens the output pane; close returns to drawers with history kept', () => {
    const { sink } = mountWithSink(root);
    const outputBtn = root.querySelector('.script-btn.output') as HTMLButtonElement;
    (root.querySelector('.script-btn.run') as HTMLButtonElement).click();
    expect((root.querySelector('.script-console-output-view') as HTMLElement).hidden).toBe(false);
    // Output is already open — the header button grays out.
    expect(outputBtn.disabled).toBe(true);
    sink.appendLine('log', 'run line');
    expect(root.querySelector('.script-console-lines')!.textContent).toContain('run line');

    (root.querySelector('.script-console-close') as HTMLButtonElement).click();
    expect((root.querySelector('.script-console-output-view') as HTMLElement).hidden).toBe(true);
    expect((root.querySelector('.script-api-reference') as HTMLElement).hidden).toBe(false);
    expect(outputBtn.disabled).toBe(false);

    outputBtn.click();
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
    (root.querySelector('.script-btn.output') as HTMLButtonElement).click();
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
    (root.querySelector('.script-btn.output') as HTMLButtonElement).click();
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

  it('each drawer filters independently with its own empty state', () => {
    mountWithSink(root);
    const [varFilter, fnFilter] = [...root.querySelectorAll('.api-ref-filter')] as HTMLInputElement[];
    const drawerNames = (i: number) =>
      [...root.querySelectorAll('.api-ref-drawer')[i]!.querySelectorAll('.api-ref-name')].map((e) => e.textContent);

    fnFilter!.value = 'burn';
    fnFilter!.dispatchEvent(new Event('input'));
    expect(drawerNames(1).some((n) => n!.startsWith('ship.burn('))).toBe(true);
    expect(drawerNames(1).some((n) => n!.startsWith('vec('))).toBe(false);
    // The variables drawer is untouched by the functions filter.
    expect(drawerNames(0)).toContain('AU');

    varFilter!.value = 'zz-no-match';
    varFilter!.dispatchEvent(new Event('input'));
    const empties = [...root.querySelectorAll('.api-ref-empty')].map((e) => e.textContent);
    expect(empties).toEqual(['No matching variables.']);
    expect(drawerNames(1).length).toBeGreaterThan(0);
  });

  it('dragging the drawer splitter resizes the two drawers with clamping', () => {
    mountWithSink(root);
    const drawers = root.querySelector('.script-api-reference') as HTMLElement;
    drawers.getBoundingClientRect = () => ({ left: 100, top: 0, width: 1000, height: 300, right: 1100, bottom: 300, x: 100, y: 0, toJSON: () => '' });
    const splitter = root.querySelector('.api-ref-splitter') as HTMLElement;
    const sections = root.querySelectorAll('.api-ref-drawer');

    splitter.dispatchEvent(new MouseEvent('mousedown', { clientX: 600 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, buttons: 1 }));
    // Left drawer is pinned to the ratio; the right one absorbs the rest.
    expect((sections[0] as HTMLElement).style.flexBasis).toBe('30.00%');
    expect((sections[1] as HTMLElement).style.flexBasis).toBe('auto');

    // Clamped at 20% / 80%.
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, buttons: 1 }));
    expect((sections[0] as HTMLElement).style.flexBasis).toBe('20.00%');
    window.dispatchEvent(new MouseEvent('mouseup'));

    // Released: further moves change nothing.
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 900, buttons: 1 }));
    expect((sections[0] as HTMLElement).style.flexBasis).toBe('20.00%');

    // A move with no button held ends a drag whose mouseup was missed.
    splitter.dispatchEvent(new MouseEvent('mousedown', { clientX: 600 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 }));
    expect((sections[0] as HTMLElement).style.flexBasis).toBe('20.00%');
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 700, buttons: 1 }));
    expect((sections[0] as HTMLElement).style.flexBasis).toBe('20.00%');
  });

  it('drawer sort reorders rows in both directions without touching the other drawer', () => {
    mountWithSink(root);
    const varSort = root.querySelectorAll('.api-ref-sort')[0] as HTMLSelectElement;
    varSort.value = 'name-desc';
    varSort.dispatchEvent(new Event('change'));
    const varNames = [...root.querySelectorAll('.api-ref-drawer')[0]!.querySelectorAll('.api-ref-name')].map((e) => e.textContent);
    expect(varNames[0]).toBe('vars');
    const fnNames = [...root.querySelectorAll('.api-ref-drawer')[1]!.querySelectorAll('.api-ref-name')].map((e) => e.textContent);
    expect(fnNames[0]!.startsWith('add(')).toBe(true);
  });

  it('renders player variables live with editable descriptions and confirmed delete', () => {
    const vars = new FakeVarsStore();
    vars.entries = [
      { name: 'burnTime', value: 123, description: 'initial', modified: Date.parse('2026-01-01T00:00:00Z') },
    ];
    const controller = fakeController();
    let sink: ConsoleSink | null = null;
    mountSequenceScreen(root, {
      storage: new FakeStorage(),
      console: controller,
      sandboxVars: vars,
      bindConsole: (s) => {
        sink = s;
      },
    });
    expect(sink).not.toBeNull();
    expect(root.querySelector('.api-ref-row.player')?.textContent).toContain('burnTime');
    const input = root.querySelector('.api-ref-description-input') as HTMLInputElement;
    expect(input.maxLength).toBe(500);
    input.value = 'main burn';
    input.dispatchEvent(new Event('change'));
    expect(vars.descriptions).toEqual([['burnTime', 'main burn']]);

    vars.entries = [
      ...vars.entries,
      { name: 'burnDv', value: { x: 0, y: 1, z: 0 }, description: '', modified: Date.parse('2026-01-02T00:00:00Z') },
    ];
    vars.emit();
    expect([...root.querySelectorAll('.api-ref-row.player .api-ref-name')].map((e) => e.textContent)).toContain('burnDv');

    const oldConfirm = window.confirm;
    window.confirm = () => true;
    (root.querySelector('[aria-label="Delete burnTime"]') as HTMLButtonElement).click();
    window.confirm = oldConfirm;
    expect(vars.deletes).toEqual(['burnTime']);
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

  it('forwards script error lines to the editor host and clears them on edit/run', () => {
    const { sink, editor } = mountWithSink(root);
    sink.setError('boom', 3);
    expect(editor.errorLine).toBe(3);

    editor.input('log("fixed")');
    expect(editor.errorLine).toBeNull();

    sink.setError('again', 2);
    expect(editor.errorLine).toBe(2);
    (root.querySelector('.script-btn.run') as HTMLButtonElement).click();
    expect(editor.errorLine).toBeNull();
  });

  it('restores a sheet error line when switching back to that sheet', () => {
    const { sink, editor } = mountWithSink(root);
    sink.setError('boom', 3);
    expect(editor.errorLine).toBe(3);

    [...root.querySelectorAll('.script-list-item')].find((e) => e.textContent === 'Calculator')!.dispatchEvent(new Event('click'));
    expect(editor.errorLine).toBeNull();

    (root.querySelector('.sheet-tab[data-sheet^="script:"]') as HTMLButtonElement).click();
    expect(editor.errorLine).toBe(3);
  });
});

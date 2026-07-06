// Script Console code-sheet workspace (src/ui/sequence/index.ts, mvp0_spec.md
// §7.9). happy-dom; the console controller is a fake.
import { describe, it, expect, beforeEach } from 'vitest';
import { mountSequenceScreen, type ScriptConsoleController, type ConsoleSink } from '../../../src/ui/sequence/index';
import type { StorageLike } from '../../../src/net/storage';

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

  it('renders a line-number gutter matching the source line count', () => {
    mountWithSink(root);
    const textarea = root.querySelector('.script-textarea') as HTMLTextAreaElement;
    textarea.value = 'a\nb\nc';
    textarea.dispatchEvent(new Event('input'));
    expect(root.querySelectorAll('.script-gutter div')).toHaveLength(3);
  });
});

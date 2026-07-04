// Sequence screen DOM shell + Script Console (src/ui/sequence/index.ts,
// mvp0_spec.md §7.9). happy-dom; the console controller is a fake.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mountSequenceScreen,
  registerSequenceTab,
  type ScriptConsoleController,
  type ConsoleSink,
} from '../../../src/ui/sequence/index';
import type { StorageLike } from '../../../src/net/storage';

class FakeStorage implements StorageLike {
  private map = new Map<string, string>();
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

describe('mountSequenceScreen', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  it('renders the tab bar with Script Console + placeholder tabs', () => {
    mountSequenceScreen(root, {
      storage: new FakeStorage(),
      console: fakeController(),
      bindConsole: () => {},
    });
    const tabs = [...root.querySelectorAll('.sequence-tab')].map((b) => b.textContent);
    expect(tabs).toEqual(['Script Console', 'Calculator', 'Candidates', 'Trajectory Predictor']);
    // Script Console is active by default.
    expect(root.querySelector('.sequence-tab.is-active')!.textContent).toBe('Script Console');
  });

  it('placeholder tabs carry a data-tab attribute and mount lazily on show', () => {
    mountSequenceScreen(root, {
      storage: new FakeStorage(),
      console: fakeController(),
      bindConsole: () => {},
    });
    const calcBtn = root.querySelector('.sequence-tab[data-tab="calculator"]') as HTMLButtonElement;
    const calcPanel = root.querySelector('.sequence-panel[data-tab="calculator"]')!;
    expect(calcPanel.textContent).toBe(''); // not mounted yet
    calcBtn.click();
    expect(calcPanel.classList.contains('is-active')).toBe(true);
    expect(calcPanel.textContent).toMatch(/later phase/);
  });

  it('accepts custom extra tabs via deps (phase-8 registration seam)', () => {
    const mounted = vi.fn();
    mountSequenceScreen(root, {
      storage: new FakeStorage(),
      console: fakeController(),
      bindConsole: () => {},
      extraTabs: [registerSequenceTab('predictor', 'Predictor', mounted)],
    });
    const tabs = [...root.querySelectorAll('.sequence-tab')].map((b) => b.textContent);
    expect(tabs).toEqual(['Script Console', 'Predictor']);
    (root.querySelector('.sequence-tab[data-tab="predictor"]') as HTMLButtonElement).click();
    expect(mounted).toHaveBeenCalledOnce();
  });

  it('Run passes the editor source to the controller; Stop calls stop', () => {
    const controller = fakeController();
    let sink: ConsoleSink | null = null;
    mountSequenceScreen(root, {
      storage: new FakeStorage(),
      console: controller,
      bindConsole: (s) => {
        sink = s;
      },
    });
    const textarea = root.querySelector('.script-textarea') as HTMLTextAreaElement;
    textarea.value = 'log(123)';
    (root.querySelector('.script-btn.run') as HTMLButtonElement).click();
    expect(controller.runs).toContain('log(123)');
    // The bridge reports running via the sink, which enables Stop (§7.9 running
    // state). Simulate that, then Stop.
    sink!.setRunning(true);
    const stopBtn = root.querySelector('.script-btn.stop') as HTMLButtonElement;
    expect(stopBtn.disabled).toBe(false);
    stopBtn.click();
    expect(controller.stops).toBe(1);
  });

  it('the bound console sink appends lines and reflects running/error state', () => {
    let sink: ConsoleSink | null = null;
    mountSequenceScreen(root, {
      storage: new FakeStorage(),
      console: fakeController(),
      bindConsole: (s) => {
        sink = s;
      },
    });
    expect(sink).not.toBeNull();
    sink!.appendLine('log', 'range = 42');
    sink!.appendLine('error', 'boom');
    const lines = [...root.querySelectorAll('.script-console-line')];
    expect(lines.length).toBe(2);
    expect(lines[1]!.classList.contains('error')).toBe(true);

    sink!.setRunning(true);
    const status = root.querySelector('.script-console-status')!;
    expect(status.textContent).toBe('running');
    sink!.setUnresponsive(true);
    expect(status.textContent).toMatch(/unresponsive/);
    sink!.setError('bad thing', 5);
    expect([...root.querySelectorAll('.script-console-line.error')].pop()!.textContent).toMatch(/line 5/);
  });

  it('creating and deleting scripts updates the list and persists', () => {
    const storage = new FakeStorage();
    mountSequenceScreen(root, { storage, console: fakeController(), bindConsole: () => {} });
    const newBtn = root.querySelector('.script-list-header .del') as HTMLButtonElement;
    newBtn.click();
    expect(root.querySelectorAll('.script-list-item').length).toBe(2);
    // Delete the second.
    const delBtns = root.querySelectorAll('.script-list-item .del');
    (delBtns[delBtns.length - 1] as HTMLButtonElement).click();
    expect(root.querySelectorAll('.script-list-item').length).toBe(1);
  });

  it('editing the name and source persists through storage', () => {
    const storage = new FakeStorage();
    const handle = mountSequenceScreen(root, { storage, console: fakeController(), bindConsole: () => {} });
    const name = root.querySelector('.script-name') as HTMLInputElement;
    name.value = 'my_burn.js';
    name.dispatchEvent(new Event('change'));
    const textarea = root.querySelector('.script-textarea') as HTMLTextAreaElement;
    textarea.value = 'await wait(10)';
    textarea.dispatchEvent(new Event('input'));
    handle.destroy();

    // Remount from the same storage: state restored.
    const root2 = document.createElement('div');
    mountSequenceScreen(root2, { storage, console: fakeController(), bindConsole: () => {} });
    expect((root2.querySelector('.script-name') as HTMLInputElement).value).toBe('my_burn.js');
    expect((root2.querySelector('.script-textarea') as HTMLTextAreaElement).value).toBe('await wait(10)');
  });

  it('renders a line-number gutter matching the source line count', () => {
    mountSequenceScreen(root, { storage: new FakeStorage(), console: fakeController(), bindConsole: () => {} });
    const textarea = root.querySelector('.script-textarea') as HTMLTextAreaElement;
    textarea.value = 'a\nb\nc';
    textarea.dispatchEvent(new Event('input'));
    expect(root.querySelectorAll('.script-gutter div').length).toBe(3);
  });
});

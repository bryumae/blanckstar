// Sequence & Calculation screen (mvp0_spec.md §7.6, §7.7, §7.9). Tab bar plus
// the Script Console (implemented here); Calculator / Candidates / Trajectory
// Predictor are placeholder panels a later phase fills — see the
// `extraTabs` registration seam so that agent adds tabs without editing this
// file. Plain DOM/CSS, no framework (repo rule 5).
import type { StorageLike } from '../../net/storage';
import { ScriptStore } from './scriptStore';
import './sequence.css';

// What the Script Console needs to drive a running script. The SandboxBridge
// implements this; the UI depends only on this surface (not the bridge class),
// so it stays DOM-only and testable.
export interface ScriptConsoleController {
  run(source: string): void;
  stop(): void;
  isRunning(): boolean;
}

// One console output line (mvp0_spec.md §7.9: logs, errors, burn/lock events).
export type ConsoleLineKind = 'log' | 'event' | 'ok' | 'error';

// A later-phase tab (Calculator / Candidates / Trajectory Predictor). Registered
// through deps so the phase-8 agent never edits this file (see registerSequenceTab).
export interface SequenceTab {
  readonly id: string;
  readonly label: string;
  // Mount the tab's content into `root`. Called once, lazily, on first show.
  readonly mount: (root: HTMLElement) => void;
}

export interface SequenceScreenDeps {
  readonly storage: StorageLike;
  readonly console: ScriptConsoleController;
  // Register the Script Console's output/status callbacks so the bridge (or a
  // test) can push lines and running/unresponsive state to the UI. Called once
  // during mount with the sink the UI exposes.
  readonly bindConsole: (sink: ConsoleSink) => void;
  // Extra tabs beyond Script Console. Optional; defaults to placeholder panels.
  readonly extraTabs?: readonly SequenceTab[];
}

// The console output sink the screen exposes to its host (the bridge writes to it).
export interface ConsoleSink {
  appendLine(kind: ConsoleLineKind, text: string): void;
  clear(): void;
  setRunning(running: boolean): void;
  setUnresponsive(unresponsive: boolean): void;
  setError(message: string, line: number | null): void;
}

export interface SequenceScreenHandle {
  destroy(): void;
}

// Default placeholder tabs (filled by phase 8). Rendered with a data-tab
// attribute so the later agent can target them.
const PLACEHOLDER_TABS: readonly { id: string; label: string }[] = [
  { id: 'calculator', label: 'Calculator' },
  { id: 'candidates', label: 'Candidates' },
  { id: 'predictor', label: 'Trajectory Predictor' },
];

export function mountSequenceScreen(root: HTMLElement, deps: SequenceScreenDeps): SequenceScreenHandle {
  root.textContent = '';
  root.classList.add('sequence-screen');

  const store = new ScriptStore(deps.storage);

  // ---- tab bar ----
  const tabBar = document.createElement('div');
  tabBar.className = 'sequence-tabs';
  const panels = document.createElement('div');
  panels.className = 'sequence-panels';
  root.append(tabBar, panels);

  interface TabRecord {
    id: string;
    button: HTMLButtonElement;
    panel: HTMLElement;
    mount?: (root: HTMLElement) => void;
    mounted: boolean;
  }
  const tabs: TabRecord[] = [];
  let activeTabId = 'script';

  function selectTab(id: string): void {
    activeTabId = id;
    for (const t of tabs) {
      const active = t.id === id;
      t.button.classList.toggle('is-active', active);
      t.panel.classList.toggle('is-active', active);
      if (active && !t.mounted && t.mount) {
        t.mount(t.panel);
        t.mounted = true;
      }
    }
  }

  function addTab(id: string, label: string, buildPanel: (panel: HTMLElement) => void, lazyMount?: (root: HTMLElement) => void): void {
    const button = document.createElement('button');
    button.className = 'sequence-tab';
    button.textContent = label;
    button.dataset.tab = id;
    button.addEventListener('click', () => selectTab(id));
    const panel = document.createElement('div');
    panel.className = 'sequence-panel';
    panel.dataset.tab = id;
    buildPanel(panel);
    tabBar.appendChild(button);
    panels.appendChild(panel);
    tabs.push({ id, button, panel, mount: lazyMount, mounted: lazyMount === undefined });
  }

  // ---- Script Console tab ----
  addTab('script', 'Script Console', (panel) => buildScriptConsole(panel));

  // ---- extra tabs (later phases) ----
  const extra = deps.extraTabs ?? PLACEHOLDER_TABS.map((t) => ({
    id: t.id,
    label: t.label,
    mount: (r: HTMLElement) => {
      const ph = document.createElement('div');
      ph.className = 'sequence-placeholder';
      ph.textContent = `${t.label} — coming in a later phase`;
      r.appendChild(ph);
    },
  }));
  for (const t of extra) {
    addTab(t.id, t.label, () => {
      /* content mounted lazily via lazyMount */
    }, t.mount);
  }

  selectTab('script');

  // ================= Script Console implementation =================
  function buildScriptConsole(panel: HTMLElement): void {
    panel.classList.add('script-console');

    // -- script list rail --
    const rail = document.createElement('div');
    rail.className = 'script-list';
    const railHeader = document.createElement('div');
    railHeader.className = 'script-list-header';
    const railTitle = document.createElement('span');
    railTitle.textContent = 'SCRIPTS';
    const newBtn = document.createElement('button');
    newBtn.className = 'del';
    newBtn.textContent = '＋';
    newBtn.title = 'New script';
    newBtn.style.color = 'var(--accent)';
    railHeader.append(railTitle, newBtn);
    const railItems = document.createElement('div');
    railItems.className = 'script-list-items';
    rail.append(railHeader, railItems);

    // -- editor column --
    const editorCol = document.createElement('div');
    editorCol.className = 'script-editor-col';
    const editorHeader = document.createElement('div');
    editorHeader.className = 'script-editor-header';
    const editorTitle = document.createElement('div');
    editorTitle.className = 'title';
    const nameInput = document.createElement('input');
    nameInput.className = 'script-name';
    nameInput.spellcheck = false;
    const badge = document.createElement('span');
    badge.className = 'script-badge';
    badge.textContent = 'SANDBOXED · WORKER';
    editorTitle.append(nameInput, badge);
    const buttons = document.createElement('div');
    buttons.className = 'script-buttons';
    const runBtn = document.createElement('button');
    runBtn.className = 'script-btn run';
    runBtn.textContent = '▸ Run';
    const stopBtn = document.createElement('button');
    stopBtn.className = 'script-btn stop';
    stopBtn.textContent = '■ Stop';
    buttons.append(runBtn, stopBtn);
    editorHeader.append(editorTitle, buttons);

    const editor = document.createElement('div');
    editor.className = 'script-editor';
    const gutter = document.createElement('div');
    gutter.className = 'script-gutter';
    const textarea = document.createElement('textarea');
    textarea.className = 'script-textarea';
    textarea.spellcheck = false;
    textarea.wrap = 'off';
    editor.append(gutter, textarea);
    editorCol.append(editorHeader, editor);

    // -- console output column --
    const outCol = document.createElement('div');
    outCol.className = 'script-console-out';
    const outHeader = document.createElement('div');
    outHeader.className = 'script-console-header';
    const outLabel = document.createElement('span');
    outLabel.className = 'label';
    outLabel.textContent = 'CONSOLE OUTPUT';
    const statusEl = document.createElement('span');
    statusEl.className = 'script-console-status';
    statusEl.textContent = 'idle';
    outHeader.append(outLabel, statusEl);
    const linesEl = document.createElement('div');
    linesEl.className = 'script-console-lines';
    const idleEl = document.createElement('div');
    idleEl.className = 'script-console-idle';
    idleEl.textContent = 'Console idle. Press Run to execute the sequence.';
    linesEl.appendChild(idleEl);
    outCol.append(outHeader, linesEl);

    panel.append(rail, editorCol, outCol);

    // ---- state + rendering ----
    let openId = store.getOpenId() ?? store.list()[0]!.id;

    function renderList(): void {
      railItems.textContent = '';
      for (const s of store.list()) {
        const item = document.createElement('div');
        item.className = 'script-list-item' + (s.id === openId ? ' is-active' : '');
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = s.name;
        const del = document.createElement('button');
        del.className = 'del';
        del.textContent = '×';
        del.title = 'Delete script';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          store.delete(s.id);
          if (openId === s.id) {
            openId = store.getOpenId() ?? store.list()[0]!.id;
            loadOpen();
          }
          renderList();
        });
        item.append(name, del);
        item.addEventListener('click', () => {
          openId = s.id;
          store.setOpen(s.id);
          loadOpen();
          renderList();
        });
        railItems.appendChild(item);
      }
    }

    function renderGutter(): void {
      const lineCount = textarea.value.split('\n').length;
      gutter.textContent = '';
      for (let i = 1; i <= lineCount; i += 1) {
        const d = document.createElement('div');
        d.textContent = String(i);
        gutter.appendChild(d);
      }
    }

    function loadOpen(): void {
      const s = store.get(openId);
      if (!s) return;
      nameInput.value = s.name;
      textarea.value = s.source;
      renderGutter();
    }

    // ---- editing ----
    nameInput.addEventListener('change', () => {
      const v = nameInput.value.trim() || 'untitled.js';
      nameInput.value = v;
      store.rename(openId, v);
      renderList();
    });
    textarea.addEventListener('input', () => {
      store.updateSource(openId, textarea.value);
      renderGutter();
    });
    textarea.addEventListener('scroll', () => {
      gutter.scrollTop = textarea.scrollTop;
    });
    newBtn.addEventListener('click', () => {
      const entry = store.create();
      openId = entry.id;
      loadOpen();
      renderList();
      nameInput.focus();
    });

    // ---- run / stop ----
    runBtn.addEventListener('click', () => {
      sink.clear();
      deps.console.run(textarea.value);
    });
    stopBtn.addEventListener('click', () => {
      deps.console.stop();
    });

    // ---- console sink (wired to the bridge via deps.bindConsole) ----
    let running = false;
    let unresponsive = false;

    function refreshStatus(): void {
      statusEl.classList.remove('is-running', 'is-unresponsive', 'is-error');
      if (unresponsive) {
        statusEl.classList.add('is-unresponsive');
        statusEl.textContent = 'unresponsive — Stop to terminate';
      } else if (running) {
        statusEl.classList.add('is-running');
        statusEl.textContent = 'running';
      } else {
        statusEl.textContent = 'idle';
      }
      runBtn.disabled = running;
      stopBtn.disabled = !running;
    }

    const sink: ConsoleSink = {
      appendLine(kind, text) {
        if (idleEl.parentElement) idleEl.remove();
        const line = document.createElement('div');
        line.className = `script-console-line ${kind}`;
        const prefix = document.createElement('span');
        prefix.className = 'prefix';
        prefix.textContent = kind === 'error' ? '✗' : kind === 'ok' ? '✓' : '›';
        const t = document.createElement('span');
        t.className = 'text';
        t.textContent = text;
        line.append(prefix, t);
        linesEl.appendChild(line);
        linesEl.scrollTop = linesEl.scrollHeight;
      },
      clear() {
        linesEl.textContent = '';
      },
      setRunning(v) {
        running = v;
        refreshStatus();
      },
      setUnresponsive(v) {
        unresponsive = v;
        refreshStatus();
      },
      setError(message, line) {
        const where = line !== null ? ` (line ${line})` : '';
        this.appendLine('error', `${message}${where}`);
      },
    };

    deps.bindConsole(sink);
    running = deps.console.isRunning();
    refreshStatus();
    loadOpen();
    renderList();
  }

  return {
    destroy(): void {
      root.textContent = '';
      root.classList.remove('sequence-screen');
    },
  };
}

// Registration seam for later-phase tabs (mvp0_spec.md §7 tabs). A phase-8 agent
// builds its tab objects and passes them via `deps.extraTabs`; this helper just
// documents/normalizes the contract without that agent editing this file.
export function registerSequenceTab(
  id: string,
  label: string,
  mount: (root: HTMLElement) => void,
): SequenceTab {
  return { id, label, mount };
}

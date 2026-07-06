// Script Console screen (mvp0_spec.md §7.9). Plain DOM/CSS, no framework
// (repo rule 5). The workspace is a set of runnable code sheets: persisted
// user scripts plus seeded calculator/candidate/predictor sheets.
import type { StorageLike } from '../../net/storage';
import { ScriptStore, type ScriptEntry } from './scriptStore';
import {
  SEEDED_SHEETS,
  ScriptConsoleWorkspaceStore,
  scriptIdFromSheetId,
  userSheetId,
  type CodeSheetState,
  type CodeSheetStatus,
  type ConsoleLineKind,
  type ConsoleOutputLine,
} from './workspaceStore';
import { createApiReferencePanel } from './apiReference';
import type { ApiReferenceVarsStore } from './apiReference';
import {
  createTextareaEditorHost,
  type EditorHost,
  type EditorHostFactory,
} from './editorHost';
import { attachSplitterDrag } from './splitter';
import './sequence.css';

export type { ConsoleLineKind } from './workspaceStore';

// What the Script Console needs to drive a running script. The SandboxBridge
// implements this; the UI depends only on this surface (not the bridge class).
export interface ScriptConsoleController {
  run(source: string): void;
  stop(): void;
  isRunning(): boolean;
}

// Retained as a legacy type for the detached GUI tab modules/tests. The Script
// Console no longer consumes these as screen modes.
export interface SequenceTab {
  readonly id: string;
  readonly label: string;
  readonly mount: (root: HTMLElement) => void;
}

export interface SequenceScreenDeps {
  readonly storage: StorageLike;
  readonly console: ScriptConsoleController;
  readonly bindConsole: (sink: ConsoleSink) => void;
  readonly sandboxVars?: ApiReferenceVarsStore;
  readonly createEditorHost?: EditorHostFactory;
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

function sheetFromScript(script: ScriptEntry): CodeSheetState {
  return {
    id: userSheetId(script.id),
    kind: 'user-script',
    name: script.name,
    source: script.source,
    outputLines: [],
    status: 'idle',
    outputVisible: false,
  };
}

function linePrefix(kind: ConsoleLineKind): string {
  if (kind === 'error') return 'x';
  if (kind === 'ok') return 'ok';
  return '>';
}

export function mountSequenceScreen(root: HTMLElement, deps: SequenceScreenDeps): SequenceScreenHandle {
  root.textContent = '';
  root.classList.add('sequence-screen', 'script-console');

  const scripts = new ScriptStore(deps.storage);
  const workspace = new ScriptConsoleWorkspaceStore(deps.storage);

  let activeSheetId = workspace.getActiveSheetId();
  let runningSheetId: string | null = deps.console.isRunning() ? activeSheetId : null;
  let unresponsive = false;
  const errorLines = new Map<string, number | null>();
  // Sheets whose output the player explicitly closed while their run was live:
  // ordinary lines from that run stop auto-reopening (the close must stick),
  // but errors and an unresponsive worker still force the pane open.
  const outputClosedForRun = new Set<string>();

  // ---- left rail ----
  const rail = document.createElement('div');
  rail.className = 'script-list';
  const railHeader = document.createElement('div');
  railHeader.className = 'script-list-header';
  const railTitle = document.createElement('span');
  railTitle.textContent = 'SHEETS';
  const newBtn = document.createElement('button');
  newBtn.className = 'del';
  newBtn.textContent = '+';
  newBtn.title = 'New script';
  newBtn.style.color = 'var(--accent)';
  railHeader.append(railTitle, newBtn);
  const railItems = document.createElement('div');
  railItems.className = 'script-list-items';
  rail.append(railHeader, railItems);

  // ---- workspace ----
  const work = document.createElement('div');
  work.className = 'script-workspace';
  const sheetTopbar = document.createElement('div');
  sheetTopbar.className = 'sheet-topbar';
  const sheetTabs = document.createElement('div');
  sheetTabs.className = 'sheet-tabs';
  const body = document.createElement('div');
  body.className = 'script-workspace-body';

  const editorCol = document.createElement('div');
  editorCol.className = 'script-editor-col';
  const buttons = document.createElement('div');
  buttons.className = 'script-buttons';
  const runBtn = document.createElement('button');
  runBtn.className = 'script-btn run';
  runBtn.textContent = 'Run';
  const stopBtn = document.createElement('button');
  stopBtn.className = 'script-btn stop';
  stopBtn.textContent = 'Stop';
  const outputBtn = document.createElement('button');
  outputBtn.className = 'script-btn output';
  outputBtn.textContent = 'Output';
  outputBtn.title = 'Show console output';
  buttons.append(runBtn, stopBtn, outputBtn);
  sheetTopbar.append(sheetTabs, buttons);

  const editorHost: EditorHost = (deps.createEditorHost ?? createTextareaEditorHost)({
    varsStore: deps.sandboxVars,
  });
  const editor = editorHost.element;
  editorCol.append(editor);

  const splitter = document.createElement('div');
  splitter.className = 'script-splitter';
  // setAttribute, not the .role IDL property — ARIA reflection is missing in
  // older engines, where the property assignment is a silent expando.
  splitter.setAttribute('role', 'separator');
  splitter.setAttribute('aria-orientation', 'horizontal');
  splitter.setAttribute('aria-label', 'Resize editor and output');
  splitter.title = 'Resize editor and output';

  // Lower pane: either the sheet's console output or the read-only API
  // reference drawers (issue #30), per the sheet's persisted outputVisible.
  const outCol = document.createElement('div');
  outCol.className = 'script-console-out is-open';
  const outputView = document.createElement('div');
  outputView.className = 'script-console-output-view';
  const outHeader = document.createElement('div');
  outHeader.className = 'script-console-header';
  const outLabel = document.createElement('span');
  outLabel.className = 'label';
  outLabel.textContent = 'CONSOLE OUTPUT';
  const statusEl = document.createElement('span');
  statusEl.className = 'script-console-status';
  const closeOutputBtn = document.createElement('button');
  closeOutputBtn.className = 'script-console-close';
  closeOutputBtn.type = 'button';
  closeOutputBtn.textContent = '×';
  closeOutputBtn.title = 'Close output';
  closeOutputBtn.setAttribute('aria-label', 'Close console output');
  const headerRight = document.createElement('div');
  headerRight.className = 'script-console-header-right';
  headerRight.append(statusEl, closeOutputBtn);
  outHeader.append(outLabel, headerRight);
  const linesEl = document.createElement('div');
  linesEl.className = 'script-console-lines';
  outputView.append(outHeader, linesEl);
  const apiReference = createApiReferencePanel(deps.sandboxVars);
  outCol.append(outputView, apiReference.element);

  body.append(editorCol, splitter, outCol);
  work.append(sheetTopbar, body);
  root.append(rail, work);

  function sheetForId(id: string): CodeSheetState | null {
    const scriptId = scriptIdFromSheetId(id);
    if (scriptId) {
      const script = scripts.get(scriptId);
      const saved = workspace.getSheet(id);
      return script
        ? { ...(saved ?? sheetFromScript(script)), name: script.name, source: script.source }
        : null;
    }
    const saved = workspace.getSheet(id);
    const seed = SEEDED_SHEETS.find((s) => s.id === id);
    return saved ?? seed ?? null;
  }

  function ensureOpen(id: string): void {
    const sheet = sheetForId(id);
    if (!sheet) return;
    workspace.openSheet(sheet);
    activeSheetId = id;
  }

  function ensureInitialSheet(): void {
    const openIds = workspace.getOpenSheetIds().filter((id) => sheetForId(id) !== null);
    if (openIds.length > 0) {
      const restored = activeSheetId && openIds.includes(activeSheetId) ? activeSheetId : openIds[0]!;
      for (const id of openIds) ensureOpen(id);
      activeSheetId = restored;
      workspace.setActive(restored);
      return;
    }
    const fallback = userSheetId(scripts.getOpenId() ?? scripts.list()[0]!.id);
    ensureOpen(fallback);
  }

  function currentSheet(): CodeSheetState {
    const sheet = activeSheetId ? sheetForId(activeSheetId) : null;
    if (!sheet) {
      ensureInitialSheet();
      return sheetForId(activeSheetId!)!;
    }
    return sheet;
  }

  function persistActiveSource(): void {
    const id = activeSheetId;
    if (!id) return;
    const source = editorHost.getValue();
    const scriptId = scriptIdFromSheetId(id);
    if (scriptId) {
      scripts.updateSource(scriptId, source);
    }
    workspace.updateSheet(id, { source });
  }

  function renderOutput(lines: readonly ConsoleOutputLine[]): void {
    linesEl.textContent = '';
    if (lines.length === 0) {
      const idleEl = document.createElement('div');
      idleEl.className = 'script-console-idle';
      idleEl.textContent = 'Console idle. Press Run to execute this sheet.';
      linesEl.appendChild(idleEl);
      return;
    }
    for (const entry of lines) {
      const line = document.createElement('div');
      line.className = `script-console-line ${entry.kind}`;
      const prefix = document.createElement('span');
      prefix.className = 'prefix';
      prefix.textContent = linePrefix(entry.kind);
      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = entry.text;
      line.append(prefix, text);
      linesEl.appendChild(line);
    }
    linesEl.scrollTop = linesEl.scrollHeight;
  }

  // Show the console output or the API reference drawers, per the active
  // sheet's outputVisible (session state — the store restores every sheet to
  // drawers on reload). Hoisted (function declaration) — the drawers panel
  // above closes over it.
  function renderLowerPane(): void {
    const sheet = currentSheet();
    outputView.hidden = !sheet.outputVisible;
    apiReference.element.hidden = sheet.outputVisible;
    // The header Output button re-opens the pane; grayed while already open.
    outputBtn.disabled = sheet.outputVisible;
    // Render lines even while hidden so the pane never shows a stale sheet.
    renderOutput(sheet.outputLines);
  }

  function effectiveStatus(sheet: CodeSheetState): CodeSheetStatus {
    if (runningSheetId === sheet.id) return unresponsive ? 'unresponsive' : 'running';
    return sheet.status === 'running' || sheet.status === 'unresponsive' ? 'idle' : sheet.status;
  }

  function renderStatus(): void {
    const sheet = currentSheet();
    const status = effectiveStatus(sheet);
    statusEl.classList.remove('is-running', 'is-unresponsive', 'is-error');
    if (status === 'unresponsive') {
      statusEl.classList.add('is-unresponsive');
      statusEl.textContent = 'unresponsive - Stop to terminate';
    } else if (status === 'running') {
      statusEl.classList.add('is-running');
      statusEl.textContent = 'running';
    } else if (status === 'error') {
      statusEl.classList.add('is-error');
      statusEl.textContent = 'error';
    } else {
      statusEl.textContent = 'idle';
    }
    runBtn.disabled = deps.console.isRunning();
    stopBtn.disabled = !deps.console.isRunning();
  }

  function applySplit(): void {
    const pct = `${(workspace.getSplitRatio() * 100).toFixed(2)}%`;
    editorCol.style.flexBasis = pct;
    outCol.style.flexBasis = `calc(100% - ${pct})`;
  }

  function selectSheet(id: string): void {
    ensureOpen(id);
    workspace.setActive(id);
    activeSheetId = id;
    const sheet = currentSheet();
    editorHost.setValue(sheet.source);
    editorHost.setErrorLine(errorLines.get(id) ?? null);
    renderLowerPane();
    renderRail();
    renderSheetTabs();
    renderStatus();
  }

  function openUserScript(script: ScriptEntry): void {
    selectSheet(userSheetId(script.id));
    scripts.setOpen(script.id);
  }

  function renderRail(): void {
    railItems.textContent = '';
    const userHeader = document.createElement('div');
    userHeader.className = 'script-list-section';
    userHeader.textContent = 'USER SCRIPTS';
    railItems.appendChild(userHeader);
    for (const script of scripts.list()) {
      const id = userSheetId(script.id);
      const item = document.createElement('div');
      item.className = 'script-list-item' + (id === activeSheetId ? ' is-active' : '');
      item.dataset.sheet = id;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = script.name;
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = 'x';
      del.title = 'Delete script';
      del.addEventListener('click', (event) => {
        event.stopPropagation();
        const wasActive = activeSheetId === id;
        scripts.delete(script.id);
        workspace.closeSheet(id, true);
        if (wasActive) {
          const nextId = userSheetId(scripts.getOpenId() ?? scripts.list()[0]!.id);
          selectSheet(nextId);
        } else {
          renderRail();
          renderSheetTabs();
        }
      });
      item.append(name, del);
      item.addEventListener('click', () => openUserScript(script));
      railItems.appendChild(item);
    }

    const seedHeader = document.createElement('div');
    seedHeader.className = 'script-list-section';
    seedHeader.textContent = 'TEMPLATES';
    railItems.appendChild(seedHeader);
    for (const seed of SEEDED_SHEETS) {
      const item = document.createElement('div');
      item.className = 'script-list-item seeded' + (seed.id === activeSheetId ? ' is-active' : '');
      item.dataset.sheet = seed.id;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent =
        seed.kind === 'calculator'
          ? 'Calculator'
          : seed.kind === 'candidates'
            ? 'Candidates'
            : seed.kind === 'predictor'
              ? 'Trajectory Predictor'
              : 'Store & recall';
      item.appendChild(name);
      item.addEventListener('click', () => selectSheet(seed.id));
      railItems.appendChild(item);
    }
  }

  function renderSheetTabs(): void {
    sheetTabs.textContent = '';
    for (const id of workspace.getOpenSheetIds()) {
      const sheet = sheetForId(id);
      if (!sheet) continue;
      const tab = document.createElement('button');
      tab.className = 'sheet-tab' + (id === activeSheetId ? ' is-active' : '');
      tab.dataset.sheet = id;
      const label = document.createElement('span');
      label.textContent = sheet.name;
      tab.appendChild(label);
      if (workspace.getOpenSheetIds().length > 1) {
        const close = document.createElement('span');
        close.className = 'sheet-tab-close';
        close.textContent = 'x';
        close.addEventListener('click', (event) => {
          event.stopPropagation();
          workspace.closeSheet(id);
          selectSheet(workspace.getActiveSheetId() ?? workspace.getOpenSheetIds()[0]!);
        });
        tab.appendChild(close);
      }
      tab.addEventListener('click', () => selectSheet(id));
      sheetTabs.appendChild(tab);
    }
  }

  function appendLineToSheet(id: string, kind: ConsoleLineKind, text: string): void {
    workspace.appendOutput(id, { kind, text });
    // Lines from a live run auto-open that sheet's output pane (issue #30) —
    // covers a remount that restored the sheet to drawers mid-run. Only the
    // receiving sheet flips; post-run event lines (scheduled burns firing
    // later) never steal the active sheet's drawers, and an explicit mid-run
    // close sticks. Errors always force the pane open.
    const liveRunLine = id === runningSheetId && !outputClosedForRun.has(id);
    if (liveRunLine || kind === 'error') {
      workspace.setOutputVisible(id, true);
    }
    if (id === activeSheetId) {
      renderLowerPane();
    }
  }

  function setActiveOutputVisible(visible: boolean): void {
    if (!activeSheetId) return;
    if (visible) {
      outputClosedForRun.delete(activeSheetId);
    } else if (activeSheetId === runningSheetId) {
      outputClosedForRun.add(activeSheetId);
    }
    workspace.setOutputVisible(activeSheetId, visible);
    renderLowerPane();
  }

  newBtn.addEventListener('click', () => {
    const script = scripts.create();
    selectSheet(userSheetId(script.id));
    editorHost.focus();
  });
  sheetTabs.addEventListener(
    'wheel',
    (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      sheetTabs.scrollLeft += event.deltaY;
      event.preventDefault();
    },
    { passive: false },
  );
  const unsubscribeEditor = editorHost.onChange(() => {
    persistActiveSource();
    if (activeSheetId) errorLines.delete(activeSheetId);
    editorHost.setErrorLine(null);
    renderSheetTabs();
  });
  runBtn.addEventListener('click', () => {
    const sheet = currentSheet();
    workspace.updateSheet(sheet.id, { outputLines: [], status: 'running', outputVisible: true });
    errorLines.delete(sheet.id);
    editorHost.setErrorLine(null);
    outputClosedForRun.delete(sheet.id);
    runningSheetId = sheet.id;
    unresponsive = false;
    renderLowerPane();
    renderStatus();
    deps.console.run(editorHost.getValue());
  });
  closeOutputBtn.addEventListener('click', () => {
    setActiveOutputVisible(false);
  });
  outputBtn.addEventListener('click', () => {
    setActiveOutputVisible(true);
  });
  stopBtn.addEventListener('click', () => {
    deps.console.stop();
  });

  attachSplitterDrag(splitter, {
    axis: 'y',
    container: body,
    resizeTarget: body,
    // The store's clampSplitRatio owns the real bounds.
    min: 0,
    max: 1,
    onRatio: (ratio) => {
      workspace.setSplitRatio(ratio);
      applySplit();
    },
  });

  const sink: ConsoleSink = {
    appendLine(kind, text) {
      const targetId = runningSheetId ?? activeSheetId!;
      appendLineToSheet(targetId, kind, text);
      if (!deps.console.isRunning() && (kind === 'ok' || kind === 'error')) {
        runningSheetId = null;
      }
    },
    clear() {
      const id = runningSheetId ?? activeSheetId;
      if (!id) return;
      workspace.clearOutput(id);
      if (id === activeSheetId) renderLowerPane();
    },
    setRunning(running) {
      if (running) {
        runningSheetId = runningSheetId ?? activeSheetId;
        if (runningSheetId) workspace.updateSheet(runningSheetId, { status: 'running' });
      } else if (runningSheetId) {
        workspace.updateSheet(runningSheetId, { status: 'idle' });
        unresponsive = false;
      }
      renderStatus();
    },
    setUnresponsive(value) {
      unresponsive = value;
      if (runningSheetId) {
        workspace.updateSheet(runningSheetId, { status: value ? 'unresponsive' : 'running' });
        // A hung script must not warn into a hidden pane — force the output
        // open on the running sheet even past an explicit close.
        if (value) {
          outputClosedForRun.delete(runningSheetId);
          workspace.setOutputVisible(runningSheetId, true);
          if (runningSheetId === activeSheetId) renderLowerPane();
        }
      }
      renderStatus();
    },
    setError(message, line) {
      const where = line !== null ? ` (line ${line})` : '';
      const id = runningSheetId ?? activeSheetId!;
      errorLines.set(id, line);
      if (id === activeSheetId) editorHost.setErrorLine(line);
      appendLineToSheet(id, 'error', `${message}${where}`);
      workspace.updateSheet(id, { status: 'error' });
      if (!deps.console.isRunning()) runningSheetId = null;
      renderStatus();
    },
  };

  deps.bindConsole(sink);
  ensureInitialSheet();
  applySplit();
  selectSheet(activeSheetId!);

  return {
    destroy(): void {
      unsubscribeEditor();
      editorHost.destroy();
      apiReference.destroy();
      root.textContent = '';
      root.classList.remove('sequence-screen', 'script-console');
    },
  };
}

export function registerSequenceTab(id: string, label: string, mount: (root: HTMLElement) => void): SequenceTab {
  return { id, label, mount };
}

import type { StorageLike } from '../../net/storage';
import { readJson, writeJson } from '../../net/storage';

export type CodeSheetKind = 'user-script' | 'calculator' | 'candidates' | 'predictor';
export type CodeSheetStatus = 'idle' | 'running' | 'unresponsive' | 'error';
export type ConsoleLineKind = 'log' | 'event' | 'ok' | 'error';

export interface ConsoleOutputLine {
  readonly kind: ConsoleLineKind;
  readonly text: string;
}

export interface CodeSheetState {
  readonly id: string;
  readonly kind: CodeSheetKind;
  readonly name: string;
  readonly source: string;
  readonly outputLines: readonly ConsoleOutputLine[];
  readonly status: CodeSheetStatus;
}

interface PersistedWorkspace {
  readonly openSheetIds: string[];
  readonly activeSheetId: string | null;
  readonly sheets: readonly CodeSheetState[];
  readonly splitRatio: number;
}

const WORKSPACE_KEY = 'blanckstar.scriptConsole.workspace.v1';
const MIN_SPLIT = 0.3;
const MAX_SPLIT = 0.75;
const DEFAULT_SPLIT = 0.56;

export const SEEDED_SHEETS: readonly CodeSheetState[] = [
  {
    id: 'seed:calculator',
    kind: 'calculator',
    name: 'calculator.js',
    status: 'idle',
    outputLines: [],
    source: `// Calculator sheet: use the sandbox vector helpers for quick checks.
const a = vec(1, 2, 3);
const b = vec(-2, 0.5, 4);

log('dot(a, b):', dot(a, b).toFixed(3));
log('cross(a, b):', cross(a, b));
log('angle degrees:', (angleBetween(a, b) * 180 / Math.PI).toFixed(3));
`,
  },
  {
    id: 'seed:candidates',
    kind: 'candidates',
    name: 'candidates.js',
    status: 'idle',
    outputLines: [],
    source: `// Candidates sheet: inspect measurements collected by this run.
const rows = await log.measurements();
log('measurements:', rows.length);

for (const m of rows.slice(-5)) {
  log(m.kind, 't=', m.t.toFixed(0), m.data);
}
`,
  },
  {
    id: 'seed:predictor',
    kind: 'predictor',
    name: 'trajectory-predictor.js',
    status: 'idle',
    outputLines: [],
    source: `// Trajectory Predictor sheet: propagate a player-entered state.
const status = await ship.status();
const epoch = await time.now();

// Replace position/velocity with your candidate state when you have one.
const position = vec(AU, 0, 0);
const velocity = vec(0, 29780, 0);
const samples = predict({ position, velocity, epoch }, [], 7 * 86400, 86400);

log('samples:', samples.length);
log('first:', samples[0]);
log('ship forward:', status.forward);
`,
  },
];

export function isSeededSheetId(id: string): boolean {
  return SEEDED_SHEETS.some((s) => s.id === id);
}

export function userSheetId(scriptId: string): string {
  return `script:${scriptId}`;
}

export function scriptIdFromSheetId(sheetId: string): string | null {
  return sheetId.startsWith('script:') ? sheetId.slice('script:'.length) : null;
}

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT;
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, ratio));
}

export class ScriptConsoleWorkspaceStore {
  private openSheetIds: string[];
  private activeSheetId: string | null;
  private sheets: CodeSheetState[];
  private splitRatio: number;

  constructor(private readonly storage: StorageLike) {
    const persisted = readJson<PersistedWorkspace>(storage, WORKSPACE_KEY);
    this.openSheetIds = persisted?.openSheetIds ? [...persisted.openSheetIds] : [];
    this.activeSheetId = persisted?.activeSheetId ?? null;
    this.sheets = persisted?.sheets ? persisted.sheets.map((s) => ({ ...s, outputLines: [...s.outputLines] })) : [];
    this.splitRatio = clampSplitRatio(persisted?.splitRatio ?? DEFAULT_SPLIT);
  }

  getOpenSheetIds(): readonly string[] {
    return this.openSheetIds;
  }

  getActiveSheetId(): string | null {
    return this.activeSheetId;
  }

  getSplitRatio(): number {
    return this.splitRatio;
  }

  getSheet(id: string): CodeSheetState | undefined {
    return this.sheets.find((s) => s.id === id);
  }

  openSheet(sheet: CodeSheetState): void {
    const existing = this.getSheet(sheet.id);
    if (!existing) {
      this.sheets.push({ ...sheet, outputLines: [...sheet.outputLines] });
    }
    if (!this.openSheetIds.includes(sheet.id)) {
      this.openSheetIds.push(sheet.id);
    }
    this.activeSheetId = sheet.id;
    this.persist();
  }

  setActive(id: string): void {
    if (this.openSheetIds.includes(id)) {
      this.activeSheetId = id;
      this.persist();
    }
  }

  closeSheet(id: string, allowEmpty = false): void {
    const idx = this.openSheetIds.indexOf(id);
    if (idx < 0 || (this.openSheetIds.length <= 1 && !allowEmpty)) return;
    this.openSheetIds.splice(idx, 1);
    if (this.activeSheetId === id) {
      this.activeSheetId = this.openSheetIds[Math.max(0, idx - 1)] ?? this.openSheetIds[0] ?? null;
    }
    this.persist();
  }

  updateSheet(id: string, patch: Partial<Omit<CodeSheetState, 'id' | 'kind'>>): void {
    const idx = this.sheets.findIndex((s) => s.id === id);
    if (idx < 0) return;
    this.sheets[idx] = { ...this.sheets[idx]!, ...patch };
    this.persist();
  }

  appendOutput(id: string, line: ConsoleOutputLine): void {
    const sheet = this.getSheet(id);
    if (!sheet) return;
    this.updateSheet(id, { outputLines: [...sheet.outputLines, line] });
  }

  clearOutput(id: string): void {
    this.updateSheet(id, { outputLines: [], status: 'idle' });
  }

  setSplitRatio(ratio: number): void {
    this.splitRatio = clampSplitRatio(ratio);
    this.persist();
  }

  private persist(): void {
    writeJson<PersistedWorkspace>(this.storage, WORKSPACE_KEY, {
      openSheetIds: this.openSheetIds,
      activeSheetId: this.activeSheetId,
      sheets: this.sheets,
      splitRatio: this.splitRatio,
    });
  }
}

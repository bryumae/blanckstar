// Named-script persistence for the sequence console (mvp0_spec.md §2.3, §7.9:
// multiple named scripts persist across retries via localStorage). Pure model
// over the injected StorageLike seam (src/net/storage) — no DOM — so it is
// round-trip testable with a fake store.
import type { StorageLike } from '../../net/storage';
import { readJson, writeJson } from '../../net/storage';

export interface ScriptEntry {
  readonly id: string;
  readonly name: string;
  readonly source: string;
}

// Persisted shape: the script list plus which one is open.
interface PersistedScripts {
  readonly scripts: ScriptEntry[];
  readonly lastOpenId: string | null;
}

const STORAGE_KEY = 'blanckstar.scripts.v1';

const STARTER_SOURCE = `// Player script — sandboxed JS (see README §Scripting API).
// Instrument/ship/wait calls are async; await them.

const lock = await radio.lockEarth();
log('range (km):', (lock.rangeMeters / 1000).toFixed(0));
log('earth dir:', lock.direction);

const sun = await sensors.sunDirection();
log('sun dir:', sun);
`;

let idCounter = 0;
function freshId(): string {
  idCounter += 1;
  return `s${Date.now().toString(36)}${idCounter.toString(36)}`;
}

// A single script's default name generator.
function defaultName(existing: readonly ScriptEntry[]): string {
  let n = existing.length + 1;
  let name = `script_${n}.js`;
  const names = new Set(existing.map((s) => s.name));
  while (names.has(name)) {
    n += 1;
    name = `script_${n}.js`;
  }
  return name;
}

// The in-memory store, backed by StorageLike. All mutations persist immediately.
export class ScriptStore {
  private scripts: ScriptEntry[];
  private lastOpenId: string | null;

  constructor(private readonly storage: StorageLike) {
    const persisted = readJson<PersistedScripts>(storage, STORAGE_KEY);
    if (persisted && persisted.scripts.length > 0) {
      this.scripts = persisted.scripts.map((s) => ({ ...s }));
      this.lastOpenId = persisted.lastOpenId ?? this.scripts[0]!.id;
    } else {
      // The seeded api-reference.js script retired with issue #30 — the
      // Script Console's API reference drawers (fed by src/sandbox/apiDocs.ts)
      // supersede it. Existing saves keep their copy; it's just a script.
      const starter: ScriptEntry = { id: freshId(), name: 'sequence.js', source: STARTER_SOURCE };
      this.scripts = [starter];
      this.lastOpenId = starter.id;
      this.persist();
    }
  }

  list(): readonly ScriptEntry[] {
    return this.scripts;
  }

  getOpenId(): string | null {
    return this.lastOpenId;
  }

  get(id: string): ScriptEntry | undefined {
    return this.scripts.find((s) => s.id === id);
  }

  setOpen(id: string): void {
    if (this.scripts.some((s) => s.id === id)) {
      this.lastOpenId = id;
      this.persist();
    }
  }

  create(): ScriptEntry {
    const entry: ScriptEntry = { id: freshId(), name: defaultName(this.scripts), source: '' };
    this.scripts.push(entry);
    this.lastOpenId = entry.id;
    this.persist();
    return entry;
  }

  updateSource(id: string, source: string): void {
    this.mutate(id, (s) => ({ ...s, source }));
  }

  rename(id: string, name: string): void {
    this.mutate(id, (s) => ({ ...s, name }));
  }

  // Delete a script. If it was open, open falls to the neighbor (or a fresh
  // starter if the list would be empty — the console always has one script).
  delete(id: string): void {
    const idx = this.scripts.findIndex((s) => s.id === id);
    if (idx < 0) return;
    this.scripts.splice(idx, 1);
    if (this.scripts.length === 0) {
      const starter: ScriptEntry = { id: freshId(), name: 'sequence.js', source: STARTER_SOURCE };
      this.scripts.push(starter);
      this.lastOpenId = starter.id;
    } else if (this.lastOpenId === id) {
      this.lastOpenId = this.scripts[Math.min(idx, this.scripts.length - 1)]!.id;
    }
    this.persist();
  }

  private mutate(id: string, fn: (s: ScriptEntry) => ScriptEntry): void {
    const idx = this.scripts.findIndex((s) => s.id === id);
    if (idx < 0) return;
    this.scripts[idx] = fn(this.scripts[idx]!);
    this.persist();
  }

  private persist(): void {
    writeJson<PersistedScripts>(this.storage, STORAGE_KEY, {
      scripts: this.scripts,
      lastOpenId: this.lastOpenId,
    });
  }
}

import type { StorageLike } from './storage';
import { readJson } from './storage';
import {
  SANDBOX_VAR_TOTAL_SIZE_LIMIT,
  cloneSandboxVarValue,
  validateSandboxVarDescription,
  validateSandboxVarName,
  validateSandboxVarValue,
  type SandboxVarEntry,
  type SandboxVarValue,
  type SandboxVarsSnapshot,
} from '../sandbox/vars';

const STORE_PREFIX = 'blanckstar.sandboxVars.v1';

export interface SandboxVarsStoreOptions {
  readonly reservedNames: ReadonlySet<string>;
  readonly now?: () => number;
  readonly totalSizeLimitBytes?: number;
}

export type SandboxVarsListener = () => void;

export class SandboxVarsStore {
  private namespace: string | null = null;
  private cachedNamespace: string | null = null;
  private cachedEntries: SandboxVarEntry[] | null = null;
  private readonly listeners = new Set<SandboxVarsListener>();
  private readonly now: () => number;
  private readonly totalSizeLimitBytes: number;

  constructor(
    private readonly storage: StorageLike,
    private readonly options: SandboxVarsStoreOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.totalSizeLimitBytes = options.totalSizeLimitBytes ?? SANDBOX_VAR_TOTAL_SIZE_LIMIT;
  }

  setNamespace(namespace: string | null): void {
    if (this.namespace === namespace) return;
    this.namespace = namespace;
    this.emit();
  }

  getNamespace(): string | null {
    return this.namespace;
  }

  snapshot(): SandboxVarsSnapshot {
    return { entries: this.readEntries() };
  }

  list(): readonly SandboxVarEntry[] {
    return this.readEntries();
  }

  setValue(name: string, value: unknown): void {
    this.requireNamespace();
    validateSandboxVarName(name, this.options.reservedNames);
    validateSandboxVarValue(value);
    const cloned = cloneSandboxVarValue(value);
    const entries = this.readEntries();
    const existing = entries.find((entry) => entry.name === name);
    const nextEntry: SandboxVarEntry = {
      name,
      value: cloned,
      description: existing?.description ?? '',
      modified: this.now(),
    };
    const next = existing
      ? entries.map((entry) => (entry.name === name ? nextEntry : entry))
      : [...entries, nextEntry];
    this.writeEntries(next, name);
  }

  setDescription(name: string, description: string): void {
    this.requireNamespace();
    validateSandboxVarName(name, this.options.reservedNames);
    validateSandboxVarDescription(description);
    const entries = this.readEntries();
    const existing = entries.find((entry) => entry.name === name);
    if (!existing) return;
    const next = entries.map((entry) =>
      entry.name === name ? { ...entry, description, modified: this.now() } : entry,
    );
    this.writeEntries(next, name);
  }

  deleteValue(name: string): void {
    this.requireNamespace();
    validateSandboxVarName(name, this.options.reservedNames);
    const next = this.readEntries().filter((entry) => entry.name !== name);
    this.writeEntries(next, name);
  }

  replaceSnapshot(snapshot: SandboxVarsSnapshot): void {
    this.requireNamespace();
    this.writeEntries(
      snapshot.entries.map((entry) => ({
        name: entry.name,
        value: cloneSandboxVarValue(entry.value),
        description: entry.description,
        modified: entry.modified,
      })),
      'snapshot',
    );
  }

  subscribe(listener: SandboxVarsListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private storageKey(): string | null {
    return this.namespace === null ? null : `${STORE_PREFIX}:${this.namespace}`;
  }

  private requireNamespace(): void {
    if (this.namespace === null) {
      throw new Error('no active game for sandbox variables');
    }
  }

  private readEntries(): SandboxVarEntry[] {
    if (this.cachedNamespace === this.namespace && this.cachedEntries !== null) {
      return this.cachedEntries.map((entry) => ({
        ...entry,
        value: cloneSandboxVarValue(entry.value),
      }));
    }
    const key = this.storageKey();
    if (!key) {
      this.cachedNamespace = this.namespace;
      this.cachedEntries = [];
      return [];
    }
    const snapshot = readJson<SandboxVarsSnapshot>(this.storage, key);
    if (!snapshot || !Array.isArray(snapshot.entries)) {
      this.cachedNamespace = this.namespace;
      this.cachedEntries = [];
      return [];
    }
    const entries: SandboxVarEntry[] = [];
    for (const entry of snapshot.entries) {
      try {
        validateSandboxVarName(entry.name, this.options.reservedNames);
        validateSandboxVarValue(entry.value);
        validateSandboxVarDescription(entry.description);
        if (!Number.isFinite(entry.modified)) continue;
        entries.push({
          name: entry.name,
          value: cloneSandboxVarValue(entry.value),
          description: entry.description,
          modified: entry.modified,
        });
      } catch {
        // Ignore corrupt rows without discarding the rest of the store.
      }
    }
    this.cachedNamespace = this.namespace;
    this.cachedEntries = entries;
    return entries.map((entry) => ({
      ...entry,
      value: cloneSandboxVarValue(entry.value),
    }));
  }

  private writeEntries(entries: readonly SandboxVarEntry[], changedName: string): void {
    const key = this.storageKey();
    if (!key) return;
    const snapshot: SandboxVarsSnapshot = { entries };
    const raw = JSON.stringify(snapshot);
    const bytes = new TextEncoder().encode(raw).length;
    if (bytes > this.totalSizeLimitBytes) {
      throw new Error(`vars.${changedName} exceeds the ${this.totalSizeLimitBytes} byte variable store limit`);
    }
    this.storage.setItem(key, raw);
    this.cachedNamespace = this.namespace;
    this.cachedEntries = entries.map((entry) => ({
      ...entry,
      value: cloneSandboxVarValue(entry.value),
    }));
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export function sandboxVarsStorageKey(namespace: string): string {
  return `${STORE_PREFIX}:${namespace}`;
}

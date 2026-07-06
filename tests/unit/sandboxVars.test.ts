import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../../src/net/storage';
import { createCurrentRun, ensureCurrentRun } from '../../src/net/currentRun';
import { SandboxVarsStore, sandboxVarsStorageKey } from '../../src/net/sandboxVars';
import { createSandboxVarsProxy } from '../../src/sandbox/vars';

class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

const reserved = new Set(['C', 'vec', 'vars']);

describe('SandboxVarsStore', () => {
  it('persists values and descriptions under separate game ids', () => {
    let now = 1000;
    const storage = new FakeStorage();
    const store = new SandboxVarsStore(storage, { reservedNames: reserved, now: () => now });
    store.setNamespace('game-a');
    store.setValue('burnTime', 123);
    now = 2000;
    store.setDescription('burnTime', 'main burn');

    store.setNamespace('game-b');
    expect(store.list()).toEqual([]);
    store.setValue('burnTime', 456);

    store.setNamespace('game-a');
    expect(store.list()).toMatchObject([
      { name: 'burnTime', value: 123, description: 'main burn', modified: 2000 },
    ]);
    expect(storage.getItem(sandboxVarsStorageKey('game-b'))).toContain('456');
  });

  it('rejects invalid values, reserved names, and oversized stores', () => {
    const storage = new FakeStorage();
    const store = new SandboxVarsStore(storage, {
      reservedNames: reserved,
      totalSizeLimitBytes: 120,
      now: () => 1,
    });
    store.setNamespace('game-a');
    expect(() => store.setValue('C', 1)).toThrow(/built-in/);
    expect(() => store.setValue('bad', Number.NaN)).toThrow(/finite/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => store.setValue('bad', cyclic)).toThrow(/cycle/);
    expect(() => store.setValue('big', 'x'.repeat(200))).toThrow(/store limit/);
  });

  it('notifies subscribers on namespace and row changes', () => {
    const storage = new FakeStorage();
    const store = new SandboxVarsStore(storage, { reservedNames: reserved, now: () => 1 });
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.setNamespace('game-a');
    store.setValue('x', 1);
    store.deleteValue('x');
    unsubscribe();
    store.setValue('x', 2);
    expect(calls).toBe(3);
  });
});

describe('createSandboxVarsProxy', () => {
  it('supports synchronous read-after-write and delete while posting mutations', () => {
    const setCalls: unknown[] = [];
    const deletes: string[] = [];
    const vars = createSandboxVarsProxy({
      snapshot: { entries: [] },
      reservedNames: reserved,
      totalSizeLimitBytes: 1024,
      setVar: (name, value) => setCalls.push([name, value]),
      deleteVar: (name) => deletes.push(name),
    });
    vars.burnDv = { x: 0, y: 12.4, z: 0 };
    expect(vars.burnDv).toEqual({ x: 0, y: 12.4, z: 0 });
    expect(vars.constructor).toBeUndefined();
    delete vars.burnDv;
    expect(vars.burnDv).toBeUndefined();
    expect(setCalls).toEqual([['burnDv', { x: 0, y: 12.4, z: 0 }]]);
    expect(deletes).toEqual(['burnDv']);
  });
});

describe('current run gameId metadata', () => {
  it('reuses the active scenario run and creates a new id for new attempts', () => {
    const storage = new FakeStorage();
    let next = 1;
    const createId = () => `game-${next++}`;
    expect(ensureCurrentRun(storage, 'close-call', createId).gameId).toBe('game-1');
    expect(ensureCurrentRun(storage, 'close-call', createId).gameId).toBe('game-1');
    expect(createCurrentRun(storage, 'close-call', createId).gameId).toBe('game-2');
    expect(ensureCurrentRun(storage, 'long-way-home', createId).gameId).toBe('game-3');
  });
});

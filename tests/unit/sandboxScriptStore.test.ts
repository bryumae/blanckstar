// Named-script persistence (src/ui/sequence/scriptStore.ts, mvp0_spec.md §2.3, §7.9).
import { describe, it, expect } from 'vitest';
import { ScriptStore } from '../../src/ui/sequence/scriptStore';
import type { StorageLike } from '../../src/net/storage';

class FakeStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

describe('ScriptStore', () => {
  it('seeds only the starter script on first use (api-reference.js retired by #30)', () => {
    const store = new ScriptStore(new FakeStorage());
    expect(store.list().length).toBe(1);
    expect(store.getOpenId()).toBe(store.list()[0]!.id);
    expect(store.list()[0]!.name).toBe('sequence.js');
    expect(store.list()[0]!.source).toMatch(/radio\.lockEarth/);
  });

  it('round-trips scripts + last-open through storage', () => {
    const storage = new FakeStorage();
    const a = new ScriptStore(storage);
    const created = a.create();
    a.updateSource(created.id, 'log(42)');
    a.rename(created.id, 'burn_plan.js');
    a.setOpen(created.id);

    const b = new ScriptStore(storage);
    expect(b.list().length).toBe(2);
    const reloaded = b.get(created.id)!;
    expect(reloaded.name).toBe('burn_plan.js');
    expect(reloaded.source).toBe('log(42)');
    expect(b.getOpenId()).toBe(created.id);
  });

  it('create generates unique default names', () => {
    const store = new ScriptStore(new FakeStorage());
    const names = new Set([store.list()[0]!.name]);
    for (let i = 0; i < 3; i += 1) {
      const e = store.create();
      expect(names.has(e.name)).toBe(false);
      names.add(e.name);
    }
  });

  it('delete falls the open selection to a neighbor', () => {
    const store = new ScriptStore(new FakeStorage());
    const created = store.create();
    const neighbor = store.list()[store.list().length - 2]!;
    store.setOpen(created.id);
    store.delete(created.id);
    expect(store.list().some((s) => s.id === created.id)).toBe(false);
    expect(store.getOpenId()).toBe(neighbor.id);
  });

  it('deleting every script reseeds a fresh starter', () => {
    const store = new ScriptStore(new FakeStorage());
    const ids = store.list().map((s) => s.id);
    for (const id of ids) store.delete(id);
    expect(store.list().length).toBe(1);
    expect(ids).not.toContain(store.list()[0]!.id);
    expect(store.getOpenId()).toBe(store.list()[0]!.id);
  });

  it('ignores mutations to unknown ids', () => {
    const store = new ScriptStore(new FakeStorage());
    expect(() => store.updateSource('nope', 'x')).not.toThrow();
    expect(() => store.rename('nope', 'x')).not.toThrow();
    expect(() => store.delete('nope')).not.toThrow();
    expect(() => store.setOpen('nope')).not.toThrow();
  });
});

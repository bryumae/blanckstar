import { describe, expect, it } from 'vitest';
import {
  forbiddenCompletionNames,
  scriptCompletionEntries,
} from '../../../src/ui/sequence/editorCompletions';
import type { SandboxVarEntry } from '../../../src/sandbox/vars';

class FakeVarsStore {
  entries: SandboxVarEntry[] = [];
  list(): readonly SandboxVarEntry[] {
    return this.entries;
  }
  setDescription(): void {}
  deleteValue(): void {}
  subscribe(): () => void {
    return () => {};
  }
}

describe('scriptCompletionEntries', () => {
  it('derives top-level sandbox names from the registry', () => {
    const entries = scriptCompletionEntries({ objectName: null, prefix: '' });
    const labels = entries.map((entry) => entry.label);
    expect(labels).toContain('ship');
    expect(labels).toContain('radio');
    expect(labels).toContain('wait');
    expect(labels).toContain('vars');
    expect(labels).toContain('C');
  });

  it('includes JavaScript keyword/operator completions at top level', () => {
    expect(scriptCompletionEntries({ objectName: null, prefix: 'aw' })).toEqual([
      expect.objectContaining({
        label: 'await',
        detail: 'JavaScript',
        type: 'keyword',
      }),
    ]);
    expect(scriptCompletionEntries({ objectName: null, prefix: 'del' })).toEqual([
      expect.objectContaining({ label: 'delete', type: 'keyword' }),
    ]);
  });

  it('derives member completions and async details from dotted registry names', () => {
    const entries = scriptCompletionEntries({ objectName: 'ship', prefix: 'bu' });
    expect(entries).toEqual([
      expect.objectContaining({
        label: 'burn',
        displayLabel: 'ship.burn',
        detail: 'async - use await',
        type: 'method',
      }),
    ]);
  });

  it('reads player variable names live for vars member completions', () => {
    const vars = new FakeVarsStore();
    vars.entries = [{ name: 'burnTime', value: 123, description: 'main burn', modified: 1 }];
    expect(scriptCompletionEntries({ objectName: 'vars', prefix: 'burn', varsStore: vars })).toEqual([
      expect.objectContaining({
        label: 'burnTime',
        displayLabel: 'vars.burnTime',
        detail: 'player variable',
      }),
    ]);

    vars.entries = [{ name: 'burnDv', value: { x: 0, y: 1, z: 0 }, description: '', modified: 2 }];
    expect(scriptCompletionEntries({ objectName: 'vars', prefix: 'burn', varsStore: vars })).toEqual([
      expect.objectContaining({ label: 'burnDv', displayLabel: 'vars.burnDv' }),
    ]);
  });

  it('never exposes forbidden API names through completions', () => {
    const allEntries = [
      ...scriptCompletionEntries({ objectName: null, prefix: '' }),
      ...scriptCompletionEntries({ objectName: 'ship', prefix: '' }),
    ];
    expect(forbiddenCompletionNames(allEntries)).toEqual([]);
  });
});

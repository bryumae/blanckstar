// Script execution model (src/sandbox/runner.ts, mvp0_spec.md §8.1, §8.3).
import { describe, it, expect } from 'vitest';
import { compileScript, extractLine, SHADOWED_NAMES } from '../../src/sandbox/runner';
import { FORBIDDEN_GLOBALS } from '../../src/sandbox/neutralize';
import type { GameApi } from '../../src/sandbox/api';

function apiWith(extra: Record<string, unknown> = {}): GameApi {
  return { log: () => {}, ...extra };
}

describe('compileScript', () => {
  it('runs a script as an async function with injected API names in scope', async () => {
    const seen: unknown[] = [];
    const api = apiWith({
      wait: async (s: number) => seen.push(['wait', s]),
      value: 42,
    });
    const compiled = compileScript('await wait(5); log(value);', api);
    await compiled.run();
    expect(seen).toEqual([['wait', 5]]);
  });

  it('lets the script await proxied calls and use their resolved values', async () => {
    const api = apiWith({
      radio: { lockEarth: async () => ({ rangeMeters: 1000 }) },
      out: [] as number[],
    });
    const compiled = compileScript(
      'const lock = await radio.lockEarth(); out.push(lock.rangeMeters);',
      api,
    );
    await compiled.run();
    expect((api.out as number[])[0]).toBe(1000);
  });

  it('shadows the §8.3 forbidden names to undefined inside the script', async () => {
    const results: Record<string, string> = {};
    const api = apiWith({
      report: (name: string, ty: string) => {
        results[name] = ty;
      },
    });
    const src = SHADOWED_NAMES.map((n) => `report(${JSON.stringify(n)}, typeof ${n});`).join('\n');
    await compileScript(src, api).run();
    for (const n of SHADOWED_NAMES) {
      expect(results[n]).toBe('undefined');
    }
  });

  it('includes every forbidden network/messaging global in the shadow backstop (#9)', () => {
    // The parameter-shadow layer must cover the §8.1 forbidden globals, not just
    // the hint names — it is the backstop for when neutralize.ts cannot delete a
    // non-configurable global. Deduped (no duplicate function parameters).
    for (const name of FORBIDDEN_GLOBALS) {
      expect(SHADOWED_NAMES).toContain(name);
    }
    for (const name of ['postMessage', 'fetch', 'importScripts', 'XMLHttpRequest', 'WebSocket', 'indexedDB']) {
      expect(SHADOWED_NAMES).toContain(name);
    }
    expect(new Set(SHADOWED_NAMES).size).toBe(SHADOWED_NAMES.length);
  });

  it('propagates a runtime error out of run()', async () => {
    const compiled = compileScript('throw new Error("boom");', apiWith());
    await expect(compiled.run()).rejects.toThrow('boom');
  });

  it('throws synchronously on a syntax error', () => {
    expect(() => compileScript('const = ;', apiWith())).toThrow();
  });
});

describe('extractLine', () => {
  it('returns null for non-Error values', () => {
    expect(extractLine('nope')).toBeNull();
    expect(extractLine(new Error('no stack but errors have one'))).not.toBe(undefined);
  });

  it('returns null when the stack has no anonymous/eval frame', () => {
    const e = new Error('x');
    e.stack = 'Error: x\n    at Object.<file>/foo.ts:10:3';
    expect(extractLine(e)).toBeNull();
  });

  it('parses a 1-based line from an <anonymous> frame (offset by header line)', () => {
    const e = new Error('x');
    e.stack = 'Error: x\n    at eval (<anonymous>:5:9)';
    expect(extractLine(e)).toBe(4);
  });
});

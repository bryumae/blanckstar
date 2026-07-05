// Global-scope neutralization (src/sandbox/neutralize.ts, mvp0_spec.md §8.1).
import { describe, it, expect } from 'vitest';
import { neutralizeGlobals, FORBIDDEN_GLOBALS } from '../../src/sandbox/neutralize';

describe('neutralizeGlobals', () => {
  it('removes every forbidden network/storage/nested-worker global', () => {
    const g: Record<string, unknown> = {};
    for (const name of FORBIDDEN_GLOBALS) {
      g[name] = () => 'dangerous';
    }
    // Keep a safe global to confirm it survives.
    g.Math = Math;
    neutralizeGlobals(g);
    for (const name of FORBIDDEN_GLOBALS) {
      expect(g[name]).toBeUndefined();
    }
    expect(g.Math).toBe(Math);
  });

  it('ignores names that are not present', () => {
    const g: Record<string, unknown> = { Math };
    expect(() => neutralizeGlobals(g)).not.toThrow();
    expect(g.fetch).toBeUndefined();
  });

  it('shadows a non-deletable-but-writable forbidden property with undefined', () => {
    const g: Record<string, unknown> = {};
    // Real worker globals are typically configurable; but exercise the fallback
    // defineProperty path with a writable, non-configurable data property.
    Object.defineProperty(g, 'fetch', { value: () => 'x', configurable: false, writable: true });
    neutralizeGlobals(g);
    expect(g.fetch).toBeUndefined();
  });

  it('swallows properties that cannot be deleted or redefined', () => {
    const g: Record<string, unknown> = {};
    // A getter-only, non-configurable property: delete returns false and
    // defineProperty throws. neutralize must not propagate the error (the
    // parameter-shadowing layer in runner.ts is the real defense here).
    Object.defineProperty(g, 'location', {
      get: () => 'ambient',
      configurable: false,
    });
    expect(() => neutralizeGlobals(g)).not.toThrow();
  });
});

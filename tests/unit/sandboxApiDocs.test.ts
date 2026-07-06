// Central sandbox-API metadata registry (src/sandbox/apiDocs.ts, issue #30).
// The registry must mirror the real buildGameApi() surface exactly — no
// undocumented API, no documented ghost — and never mention the forbidden
// surface (mvp0_spec.md §8.3).
import { describe, it, expect, vi } from 'vitest';
import { buildGameApi } from '../../src/sandbox/api';
import {
  FORBIDDEN_API_NAMES,
  SANDBOX_API_DOCS,
  filterDocs,
  sortDocs,
  type SandboxApiDoc,
} from '../../src/sandbox/apiDocs';
import { loadRealEphemeris } from './simHelpers';

const eph = loadRealEphemeris();

// Walk the real API object into dotted leaf names: functions are leaves (but
// may carry documented sub-members, e.g. log.measurements), plain objects are
// namespaces, and everything else (constants) is a leaf.
function collectApiNames(api: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'function') {
      names.add(path);
      for (const key of Object.keys(value)) {
        visit((value as unknown as Record<string, unknown>)[key], `${path}.${key}`);
      }
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, v] of Object.entries(value)) visit(v, `${path}.${key}`);
      return;
    }
    names.add(path);
  };
  for (const [key, v] of Object.entries(api)) visit(v, key);
  return names;
}

// The definitive async set from api.ts/protocol.ts: exactly the members that
// proxy through the bridge.
const ASYNC_NAMES = [
  'time.now',
  'wait',
  'log.measurements',
  'radio.lockEarth',
  'sensors.sunDirection',
  'sensors.starAttitude',
  'telescope.angularSeparation',
  'ephemeris.position',
  'ephemeris.velocity',
  'ship.point',
  'ship.burn',
  'ship.scheduleBurn',
  'ship.cancelBurn',
  'ship.status',
] as const;

const CONSTANT_NAMES = [
  'C', 'MU_SUN', 'MU_EARTH', 'MU_MOON', 'R_EARTH', 'R_MOON', 'R_SOI_EARTH', 'AU', 'SHIP_MASS_KG',
] as const;

describe('SANDBOX_API_DOCS registry', () => {
  it('is set-equal with the runtime buildGameApi() surface', () => {
    const api = buildGameApi({ callBridge: vi.fn(async () => undefined), ephemeris: eph, log: vi.fn() });
    const runtimeNames = [...collectApiNames(api)].sort();
    const docNames = SANDBOX_API_DOCS.map((d) => d.name).sort();
    expect(docNames).toEqual(runtimeNames);
  });

  it('has no duplicate names', () => {
    const names = SANDBOX_API_DOCS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('never mentions the forbidden §8.3 surface', () => {
    expect(FORBIDDEN_API_NAMES.length).toBeGreaterThan(0);
    for (const doc of SANDBOX_API_DOCS) {
      for (const forbidden of FORBIDDEN_API_NAMES) {
        expect(doc.name === forbidden || doc.name.startsWith(`${forbidden}.`), `${doc.name} vs ${forbidden}`).toBe(false);
      }
    }
  });

  it('flags exactly the proxied methods as async', () => {
    const asyncDocs = SANDBOX_API_DOCS.filter((d) => d.kind === 'function' && d.async).map((d) => d.name);
    expect(asyncDocs.sort()).toEqual([...ASYNC_NAMES].sort());
  });

  it('documents every constant as a variable carrying its bare numeric value', () => {
    for (const name of CONSTANT_NAMES) {
      const doc = SANDBOX_API_DOCS.find((d) => d.name === name);
      expect(doc?.kind).toBe('variable');
      // Numbers carry no type prefix — only a future non-number type would.
      // Round-trip through Number: pins the value to exactly what String()
      // renders for a real number (rejects prefixes and garbage alike).
      const value = (doc as { value: string }).value;
      expect(String(Number(value))).toBe(value);
    }
    const variables = SANDBOX_API_DOCS.filter((d) => d.kind === 'variable').map((d) => d.name);
    expect(variables.sort()).toEqual([...CONSTANT_NAMES].sort());
  });

  it('marks async descriptions with await usage and sync ones as synchronous', () => {
    for (const doc of SANDBOX_API_DOCS) {
      if (doc.kind !== 'function') continue;
      if (doc.async) {
        expect(doc.description, doc.name).toMatch(/^Async\. Use await /);
      } else {
        expect(doc.description, doc.name).toContain('Synchronous — no await.');
      }
    }
  });

  it('is builtin-sourced throughout (player entries arrive with #31)', () => {
    expect(SANDBOX_API_DOCS.every((d) => d.source === 'builtin')).toBe(true);
  });
});

describe('filterDocs', () => {
  const docs = SANDBOX_API_DOCS;

  it('matches on name, case-insensitively', () => {
    const hits = filterDocs(docs, 'SHIP.BURN');
    expect(hits.map((d) => d.name)).toContain('ship.burn');
  });

  it('matches on description', () => {
    const hits = filterDocs(docs, 'light-time');
    expect(hits.map((d) => d.name)).toEqual(['radio.lockEarth']);
  });

  it('returns everything for an empty or whitespace query', () => {
    expect(filterDocs(docs, '')).toHaveLength(docs.length);
    expect(filterDocs(docs, '   ')).toHaveLength(docs.length);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterDocs(docs, 'zz-no-such-thing')).toEqual([]);
  });
});

describe('sortDocs', () => {
  const sample: SandboxApiDoc[] = [
    { kind: 'variable', name: 'beta', description: 'Zeta first.', source: 'builtin', value: '1' },
    { kind: 'variable', name: 'Alpha', description: 'middle row.', source: 'builtin', value: '2' },
    { kind: 'variable', name: 'gamma', description: 'apex row.', source: 'builtin', value: '3' },
  ];

  it('sorts by name in both directions, case-insensitively', () => {
    expect(sortDocs(sample, 'name', 'asc').map((d) => d.name)).toEqual(['Alpha', 'beta', 'gamma']);
    expect(sortDocs(sample, 'name', 'desc').map((d) => d.name)).toEqual(['gamma', 'beta', 'Alpha']);
  });

  it('sorts by description in both directions', () => {
    expect(sortDocs(sample, 'description', 'asc').map((d) => d.name)).toEqual(['gamma', 'Alpha', 'beta']);
    expect(sortDocs(sample, 'description', 'desc').map((d) => d.name)).toEqual(['beta', 'Alpha', 'gamma']);
  });

  it('is stable and never mutates its input', () => {
    const tied: SandboxApiDoc[] = [
      { kind: 'variable', name: 'same', description: 'first', source: 'builtin', value: '1' },
      { kind: 'variable', name: 'same', description: 'second', source: 'builtin', value: '2' },
    ];
    const sorted = sortDocs(tied, 'name', 'asc');
    expect(sorted.map((d) => d.description)).toEqual(['first', 'second']);
    const before = sample.map((d) => d.name);
    sortDocs(sample, 'name', 'desc');
    expect(sample.map((d) => d.name)).toEqual(before);
  });
});

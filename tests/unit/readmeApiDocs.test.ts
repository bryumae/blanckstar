import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SANDBOX_API_DOCS,
  type SandboxApiDoc,
} from '../../src/sandbox/apiDocs';

const readme = readFileSync('README.md', 'utf8');

function readmeApiRows(): Map<string, { kind: string; awaitText: string }> {
  const rows = new Map<string, { kind: string; awaitText: string }>();
  for (const line of readme.split('\n')) {
    const match = /^\| `([^`]+)` \| ([^|]+) \| ([^|]+) \|$/.exec(line.trim());
    if (!match) continue;
    rows.set(match[1]!, { kind: match[2]!.trim(), awaitText: match[3]!.trim() });
  }
  return rows;
}

function expectedRow(doc: SandboxApiDoc): { kind: string; awaitText: string } {
  return {
    kind: doc.kind,
    awaitText: doc.kind === 'function' && doc.async ? 'yes' : 'no',
  };
}

describe('README Scripting API table', () => {
  it('is drift-tested against the sandbox API registry', () => {
    const rows = readmeApiRows();
    expect([...rows.keys()].sort()).toEqual(SANDBOX_API_DOCS.map((doc) => doc.name).sort());
    for (const doc of SANDBOX_API_DOCS) {
      expect(rows.get(doc.name)).toEqual(expectedRow(doc));
    }
  });
});

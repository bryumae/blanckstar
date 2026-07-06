import { describe, expect, it } from 'vitest';
import { SANDBOX_API_DOCS } from '../../../src/sandbox/apiDocs';
import { SEEDED_SHEETS } from '../../../src/ui/sequence/workspaceStore';

describe('Script Console seeded sheets', () => {
  it('do not reintroduce the retired API reference seed', () => {
    for (const sheet of SEEDED_SHEETS) {
      const combined = `${sheet.id}\n${sheet.name}\n${sheet.source}`.toLowerCase();
      expect(combined).not.toContain('api-reference');
      expect(combined).not.toContain('api reference');
    }
  });

  it('remain workflow templates rather than duplicated registry tables', () => {
    const registryNames = SANDBOX_API_DOCS.map((doc) => doc.name);
    for (const sheet of SEEDED_SHEETS) {
      const mentionedNames = registryNames.filter((name) => sheet.source.includes(name));
      expect(mentionedNames.length, sheet.name).toBeLessThan(10);
    }
  });
});

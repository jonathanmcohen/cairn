import { describe, expect, it } from 'vitest';
import { importNotion } from '@/lib/import/notion';

const fixture = {
  files: [
    { path: 'Parent abc123.md', content: '# Parent\n\nSee [[def456]].\n' },
    { path: 'Parent abc123/Child def456.md', content: '# Child\n\nSynced block placeholder.\n' },
  ],
};

describe('importNotion', () => {
  it('rewrites intra-export id references to freshly-minted Cairn ids', async () => {
    const { payload } = await importNotion(fixture);
    const parent = payload.pages.find((p) => p.title === 'Parent');
    const child = payload.pages.find((p) => p.title === 'Child');
    expect(parent).toBeTruthy();
    expect(child).toBeTruthy();
    expect(parent!.id).not.toBe('abc123');
    expect(child!.id).not.toBe('def456');
    expect(child!.parentId).toBe(parent!.id);
    // The child's new id appears in the parent's content (the [[def456]] reference was rewritten).
    expect(JSON.stringify(parent!.content)).toContain(child!.id);
  });

  it('produces a report enumerating fidelity gaps as per-item warnings', async () => {
    const { report } = await importNotion(fixture);
    expect(report.counts.pages).toBe(2);
    expect(Array.isArray(report.warnings)).toBe(true);
    expect(report.warnings.some((w) => /synced block/i.test(w.message))).toBe(true);
  });
});

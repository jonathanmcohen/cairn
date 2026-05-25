// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getDocIndexEntries,
  recordDocAccess,
  removeDocFromIndex,
  resetDocIndexForTests,
  totalIndexedBytes,
} from '@/lib/offline/doc-index';

beforeEach(async () => {
  await resetDocIndexForTests();
});

describe('doc-index', () => {
  it('records access timestamps + sizes per (workspaceId, pageId)', async () => {
    await recordDocAccess({ workspaceId: 'w1', pageId: 'p1', sizeBytes: 1000 });
    await recordDocAccess({ workspaceId: 'w1', pageId: 'p2', sizeBytes: 500 });
    const entries = await getDocIndexEntries('w1');
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.pageId === 'p1')?.sizeBytes).toBe(1000);
  });

  it('updates lastAccessedAt on re-access', async () => {
    await recordDocAccess({ workspaceId: 'w1', pageId: 'p1', sizeBytes: 100 });
    const first = (await getDocIndexEntries('w1'))[0]!.lastAccessedAt;
    await new Promise((r) => setTimeout(r, 5));
    await recordDocAccess({ workspaceId: 'w1', pageId: 'p1', sizeBytes: 200 });
    const second = (await getDocIndexEntries('w1'))[0]!.lastAccessedAt;
    expect(second).toBeGreaterThan(first);
    expect((await getDocIndexEntries('w1'))[0]!.sizeBytes).toBe(200);
  });

  it('isolates per-workspace', async () => {
    await recordDocAccess({ workspaceId: 'w1', pageId: 'p1', sizeBytes: 100 });
    await recordDocAccess({ workspaceId: 'w2', pageId: 'p1', sizeBytes: 200 });
    expect(await getDocIndexEntries('w1')).toHaveLength(1);
    expect(await getDocIndexEntries('w2')).toHaveLength(1);
  });

  it('totalIndexedBytes sums per-workspace', async () => {
    await recordDocAccess({ workspaceId: 'w1', pageId: 'p1', sizeBytes: 100 });
    await recordDocAccess({ workspaceId: 'w1', pageId: 'p2', sizeBytes: 250 });
    expect(await totalIndexedBytes('w1')).toBe(350);
  });

  it('removeDocFromIndex removes one entry', async () => {
    await recordDocAccess({ workspaceId: 'w1', pageId: 'p1', sizeBytes: 100 });
    await removeDocFromIndex({ workspaceId: 'w1', pageId: 'p1' });
    expect(await getDocIndexEntries('w1')).toHaveLength(0);
  });
});

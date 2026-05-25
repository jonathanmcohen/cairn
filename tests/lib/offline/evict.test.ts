// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getDocIndexEntries,
  recordDocAccess,
  resetDocIndexForTests,
} from '@/lib/offline/doc-index';
import { evictUntilUnderCap } from '@/lib/offline/evict';

beforeEach(async () => {
  await resetDocIndexForTests();
});

async function seed(
  workspaceId: string,
  items: Array<{ pageId: string; sizeBytes: number; ageOffsetMs: number }>,
) {
  // Seed in order so lastAccessedAt is monotonic; the oldest entry (largest
  // ageOffsetMs) lands first. Sleep 2ms between to ensure distinct timestamps.
  const sorted = [...items].sort((a, b) => b.ageOffsetMs - a.ageOffsetMs);
  for (const item of sorted) {
    await recordDocAccess({ workspaceId, pageId: item.pageId, sizeBytes: item.sizeBytes });
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe('evictUntilUnderCap', () => {
  it('returns 0 evictions when already under cap', async () => {
    await seed('w1', [{ pageId: 'p1', sizeBytes: 1000, ageOffsetMs: 0 }]);
    const result = await evictUntilUnderCap({ workspaceId: 'w1', capBytes: 10000 });
    expect(result.evictedPageIds).toEqual([]);
    expect(result.bytesAfter).toBe(1000);
  });

  it('evicts oldest first until under cap', async () => {
    await seed('w1', [
      { pageId: 'old', sizeBytes: 500, ageOffsetMs: 100 },
      { pageId: 'mid', sizeBytes: 500, ageOffsetMs: 50 },
      { pageId: 'new', sizeBytes: 500, ageOffsetMs: 0 },
    ]);
    const result = await evictUntilUnderCap({ workspaceId: 'w1', capBytes: 700 });
    // total starts at 1500; cap is 700; need to evict to ≤ 700 → kick `old` (now 1000) + `mid` (now 500)
    expect(result.evictedPageIds).toEqual(['old', 'mid']);
    expect(result.bytesAfter).toBe(500);
    const remaining = await getDocIndexEntries('w1');
    expect(remaining.map((e) => e.pageId)).toEqual(['new']);
  });

  it('isolates per-workspace (only evicts target workspace)', async () => {
    await seed('w1', [{ pageId: 'p1', sizeBytes: 1000, ageOffsetMs: 0 }]);
    await seed('w2', [{ pageId: 'q1', sizeBytes: 1000, ageOffsetMs: 0 }]);
    await evictUntilUnderCap({ workspaceId: 'w1', capBytes: 0 });
    expect(await getDocIndexEntries('w1')).toHaveLength(0);
    expect(await getDocIndexEntries('w2')).toHaveLength(1);
  });
});

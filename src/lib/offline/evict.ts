import {
  getDocIndexEntries,
  removeDocFromIndex,
  totalIndexedBytes,
} from './doc-index';

/**
 * y-indexeddb stores each Yjs doc under a database named for the doc-name
 * (page id, scoped by workspace). Deleting the index entry alone leaves the
 * underlying doc storage behind, so we also call indexedDB.deleteDatabase
 * for that doc's storage to actually reclaim bytes.
 *
 * Naming convention: `useCollabDoc` (Task 3) passes the doc-name
 * `${workspaceId}:${pageId}` to `new IndexeddbPersistence(name, doc)`,
 * so y-indexeddb opens an IDB database of that name.
 */
function docDbName(workspaceId: string, pageId: string): string {
  return `${workspaceId}:${pageId}`;
}

async function deleteDocDatabase(workspaceId: string, pageId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(docDbName(workspaceId, pageId));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    // `blocked` fires when another open connection holds the DB; we still
    // count it as success — the next page-open will re-prime the doc from
    // the server.
    req.onblocked = () => resolve();
  });
}

export type EvictionResult = {
  evictedPageIds: string[];
  bytesAfter: number;
};

/**
 * Evict the oldest-accessed docs for `workspaceId` until total indexed bytes
 * for that workspace fall to ≤ `capBytes`. Returns the list of evicted page
 * ids (oldest-first order) and the post-eviction byte total.
 */
export async function evictUntilUnderCap(input: {
  workspaceId: string;
  capBytes: number;
}): Promise<EvictionResult> {
  const evicted: string[] = [];
  let bytes = await totalIndexedBytes(input.workspaceId);
  if (bytes <= input.capBytes) return { evictedPageIds: [], bytesAfter: bytes };

  // Oldest-first.
  const entries = (await getDocIndexEntries(input.workspaceId)).sort(
    (a, b) => a.lastAccessedAt - b.lastAccessedAt,
  );

  for (const entry of entries) {
    if (bytes <= input.capBytes) break;
    await deleteDocDatabase(input.workspaceId, entry.pageId);
    await removeDocFromIndex({ workspaceId: input.workspaceId, pageId: entry.pageId });
    evicted.push(entry.pageId);
    bytes -= entry.sizeBytes;
  }
  return { evictedPageIds: evicted, bytesAfter: bytes };
}

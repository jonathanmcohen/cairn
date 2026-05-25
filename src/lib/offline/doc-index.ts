/**
 * Per-workspace doc-index in IndexedDB. Tracks last-accessed timestamps and
 * byte sizes of cached Yjs docs so the eviction job (./evict.ts) can pick
 * FIFO victims when the total exceeds CAIRN_OFFLINE_DOC_LIMIT_MB.
 *
 * Store name: `cairn-offline-doc-index`; key: `${workspaceId}/${pageId}`.
 * Each row: { workspaceId, pageId, lastAccessedAt, sizeBytes }.
 */

const DB_NAME = 'cairn-offline';
const STORE = 'doc-index';
const DB_VERSION = 1;

export type DocIndexEntry = {
  workspaceId: string;
  pageId: string;
  lastAccessedAt: number; // ms since epoch
  sizeBytes: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('workspaceId', 'workspaceId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function keyFor(workspaceId: string, pageId: string): string {
  return `${workspaceId}/${pageId}`;
}

export async function recordDocAccess(input: {
  workspaceId: string;
  pageId: string;
  sizeBytes: number;
}): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put({
      key: keyFor(input.workspaceId, input.pageId),
      workspaceId: input.workspaceId,
      pageId: input.pageId,
      lastAccessedAt: Date.now(),
      sizeBytes: input.sizeBytes,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getDocIndexEntries(workspaceId: string): Promise<DocIndexEntry[]> {
  const db = await openDb();
  return new Promise<DocIndexEntry[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const idx = store.index('workspaceId');
    const req = idx.getAll(IDBKeyRange.only(workspaceId));
    req.onsuccess = () => {
      db.close();
      // Strip the synthetic `key` field; return clean DocIndexEntry rows.
      resolve(
        (req.result as Array<DocIndexEntry & { key: string }>).map((r) => ({
          workspaceId: r.workspaceId,
          pageId: r.pageId,
          lastAccessedAt: r.lastAccessedAt,
          sizeBytes: r.sizeBytes,
        })),
      );
    };
    req.onerror = () => reject(req.error);
  });
}

export async function totalIndexedBytes(workspaceId: string): Promise<number> {
  const entries = await getDocIndexEntries(workspaceId);
  return entries.reduce((acc, e) => acc + e.sizeBytes, 0);
}

export async function removeDocFromIndex(input: {
  workspaceId: string;
  pageId: string;
}): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(keyFor(input.workspaceId, input.pageId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Test-only: clear all entries. */
export async function resetDocIndexForTests(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

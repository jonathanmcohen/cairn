/**
 * Per-user recent-commands list, persisted in localStorage under
 * `cairn:palette:recents:<userId>`. Stored shape: an array of
 * `{id, ts}` records newest-first, capped at MAX_STORED.
 *
 * Read API (`getRecents`) returns just the ids. Write API (`pushRecent`)
 * dedupes (re-push bumps to top) and debounces (second push of the same id
 * within DEBOUNCE_MS of the previous push is silently dropped — prevents nav
 * actions from spamming the list when the user re-fires the same shortcut).
 *
 * Clock is injectable for tests via __setRecentsClockForTests.
 */

const PREFIX = 'cairn:palette:recents:';
const MAX_STORED = 20;
const DEBOUNCE_MS = 1000;

type Record = { id: string; ts: number };

let clockOverride: number | null = null;

function now(): number {
  return clockOverride ?? Date.now();
}

function key(userId: string): string {
  return `${PREFIX}${userId}`;
}

function readRaw(userId: string): Record[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is Record =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as Record).id === 'string' &&
        typeof (r as Record).ts === 'number',
    );
  } catch {
    return [];
  }
}

function writeRaw(userId: string, records: Record[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key(userId), JSON.stringify(records));
  } catch {
    // Quota — swallow; recents are not load-bearing.
  }
}

export function getRecents(userId: string): string[] {
  return readRaw(userId).map((r) => r.id);
}

export function pushRecent(userId: string, actionId: string): void {
  const current = readRaw(userId);
  const ts = now();
  const existingIdx = current.findIndex((r) => r.id === actionId);
  if (existingIdx === 0) {
    // Same id at the top — apply debounce.
    const head = current[0];
    if (head && ts - head.ts < DEBOUNCE_MS) return;
    current[0] = { id: actionId, ts };
    writeRaw(userId, current);
    return;
  }
  if (existingIdx > 0) {
    // Same id but not at the top — also apply debounce against its previous
    // push, then move to front.
    const existing = current[existingIdx];
    if (existing && ts - existing.ts < DEBOUNCE_MS) return;
    current.splice(existingIdx, 1);
  }
  current.unshift({ id: actionId, ts });
  if (current.length > MAX_STORED) current.length = MAX_STORED;
  writeRaw(userId, current);
}

export function clearRecents(userId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(key(userId));
  } catch {
    // ignore
  }
}

/** Test-only — override the clock so debounce + ordering are deterministic. */
export function __setRecentsClockForTests(ts: number): void {
  clockOverride = ts;
}

/** Test-only — clear the clock override. */
export function __resetRecentsClockForTests(): void {
  clockOverride = null;
}

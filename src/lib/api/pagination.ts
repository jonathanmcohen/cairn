export type Cursor = { createdAt: string; id: string };

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

/** Opaque base64url cursor over a (createdAt, id) keyset. */
export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Cursor).createdAt === 'string' &&
      typeof (parsed as Cursor).id === 'string'
    ) {
      return parsed as Cursor;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseListQuery(url: URL): { limit: number; cursor: Cursor | null } {
  const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit = Number.isNaN(rawLimit) ? DEFAULT_LIMIT : Math.min(MAX_LIMIT, Math.max(1, rawLimit));
  return { limit, cursor: decodeCursor(url.searchParams.get('cursor')) };
}

/** Build the `{ data, nextCursor }` envelope from a fetched page of rows. */
export function pageResult<T extends { id: string; createdAt: Date }>(
  rows: T[],
  limit: number,
): { data: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
  return { data, nextCursor };
}

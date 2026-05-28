import { and, eq, inArray } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { type DiffBlock, diffSnapshots, type PMDoc } from '@/lib/pages/version-diff';
import { VersionDiffViewer } from './viewer';

export type DiffLoadInput = { pageId: string; a: string | undefined; b: string | undefined };

export type DiffLoadOutput = {
  page: { id: string; title: string };
  snapshotA: { id: string; createdAt: Date; content: PMDoc };
  snapshotB: { id: string; createdAt: Date; content: PMDoc };
  diff: DiffBlock[];
};

/**
 * ACL-gated data loader. Throws HttpError(400) on missing params and
 * HttpError(404) on missing/mismatched versions, encrypted pages, or
 * cross-workspace access (the latter delegated to requirePageAccess).
 *
 * Exported so it can be unit-tested without a Next.js render harness.
 */
export async function loadDiffData(input: DiffLoadInput): Promise<DiffLoadOutput> {
  if (!input.a || !input.b) {
    throw new HttpError(400, 'a and b query params required');
  }
  const { page } = await requirePageAccess(input.pageId, 'viewer');

  // Encrypted pages store ciphertext, not jsonb the server can read. Refuse
  // diff so we don't surface an opaque error to the client. The viewer
  // would need the workspace key, which only lives client-side.
  if (page.encrypted) {
    throw new HttpError(404, 'cannot diff encrypted pages');
  }

  const rows = await getDb()
    .select()
    .from(schema.pageVersions)
    .where(
      and(
        eq(schema.pageVersions.pageId, input.pageId),
        inArray(schema.pageVersions.id, [input.a, input.b]),
      ),
    );

  // When a === b, the inArray collapses to one id → at most one row comes
  // back. Treat any non-2-distinct outcome as not-found.
  const rowA = rows.find((r) => r.id === input.a);
  const rowB = rows.find((r) => r.id === input.b);
  if (!rowA || !rowB) throw new HttpError(404, 'one or both versions not found');

  const a = rowA.content as PMDoc;
  const b = rowB.content as PMDoc;
  const diff = diffSnapshots(a, b);
  return {
    page: { id: page.id, title: page.title },
    snapshotA: { id: rowA.id, createdAt: rowA.createdAt, content: a },
    snapshotB: { id: rowB.id, createdAt: rowB.createdAt, content: b },
    diff,
  };
}

type PageProps = {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<{ a?: string; b?: string }>;
};

export default async function VersionDiffPage(props: PageProps) {
  const { pageId } = await props.params;
  const sp = await props.searchParams;
  try {
    const data = await loadDiffData({ pageId, a: sp.a, b: sp.b });
    return (
      <main className="p-6">
        <h1 className="mb-4 font-semibold text-2xl">{data.page.title} — version diff</h1>
        <VersionDiffViewer diff={data.diff} snapshotA={data.snapshotA} snapshotB={data.snapshotB} />
      </main>
    );
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }
}

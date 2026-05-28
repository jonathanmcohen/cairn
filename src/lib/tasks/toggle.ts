/**
 * v0.9.0 G4 P23 — Tasks hub server-side mutator.
 *
 * Direct-JSON toggle of a TipTap `taskItem`'s `checked` attr on the page's
 * `pages.content` jsonb. Chosen over a full Yjs server-side mutation because
 * checkbox state is atomic + idempotent (single boolean) — the v0.3 collab
 * channel re-reads from DB on the next sync, so any open editor picks up the
 * change after its next sync round-trip. For richer (multi-char) edits we'd
 * need a real Yjs server-side path; that's out of scope here.
 *
 * Encrypted pages are refused — their `content` jsonb is empty by contract
 * (P5/P6/P7) and toggling there would silently no-op.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { recordAudit } from '@/lib/audit/record';

type ContentNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: ContentNode[];
};

function walkAndToggle(node: ContentNode, blockId: string): { found: boolean; checked: boolean } {
  if (
    node.type === 'taskItem' &&
    (node.attrs as { blockId?: string } | undefined)?.blockId === blockId
  ) {
    const wasChecked =
      ((node.attrs as { checked?: boolean } | undefined)?.checked ?? false) === true;
    const nextChecked = !wasChecked;
    node.attrs = { ...(node.attrs ?? {}), checked: nextChecked };
    return { found: true, checked: nextChecked };
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const r = walkAndToggle(child, blockId);
      if (r.found) return r;
    }
  }
  return { found: false, checked: false };
}

export async function toggleTaskCheck(input: {
  pageId: string;
  blockId: string;
  userId: string;
}): Promise<{ checked: boolean }> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT content, workspace_id, encrypted
    FROM pages
    WHERE id = ${input.pageId} AND deleted_at IS NULL
  `)) as unknown as Array<{ content: ContentNode; workspace_id: string; encrypted: boolean }>;
  const page = rows[0];
  if (!page) throw new Error('page not found');
  if (page.encrypted) throw new Error('cannot toggle task on encrypted page');

  const content = structuredClone(page.content);
  const result = walkAndToggle(content, input.blockId);
  if (!result.found) throw new Error('task block not found');

  await db.execute(sql`
    UPDATE pages SET content = ${JSON.stringify(content)}::jsonb, updated_at = now()
    WHERE id = ${input.pageId}
  `);

  await recordAudit(db, {
    workspaceId: page.workspace_id,
    actorUserId: input.userId,
    action: 'task.toggled',
    targetType: 'page',
    targetId: input.pageId,
    metadata: { blockId: input.blockId, checked: result.checked },
  });

  return { checked: result.checked };
}

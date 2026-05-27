import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

export type CreateSpaceInput = {
  workspaceId: string;
  actorId: string;
  name: string;
  slug: string;
  icon?: string | null;
  parentSpaceId?: string | null;
  position?: number;
};

export type CreateSpaceResult =
  | { ok: true; space: schema.Space }
  | { ok: false; code: 'duplicate_slug' | 'invalid_parent' };

/**
 * Insert + audit a new space. Wrapped in `db.transaction(...)` so the audit
 * row and the insert can never drift (retrospective lesson from v0.8.0).
 *
 * Returns a tagged union — callers must inspect `ok` before assuming a row.
 * Postgres unique-violation (23505) on the slug is mapped to `duplicate_slug`;
 * a parent_space_id in a different workspace returns `invalid_parent`.
 */
export async function createSpace(
  db: PostgresJsDatabase<typeof schema>,
  input: CreateSpaceInput,
): Promise<CreateSpaceResult> {
  if (input.parentSpaceId) {
    const [parent] = await db
      .select({ workspaceId: schema.spaces.workspaceId })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, input.parentSpaceId));
    if (!parent || parent.workspaceId !== input.workspaceId) {
      return { ok: false, code: 'invalid_parent' };
    }
  }
  // Pre-check the per-workspace slug uniqueness. The unique index is still
  // the source of truth (handles races), but a pre-check returns the
  // structured `duplicate_slug` code without depending on driver-specific
  // error-code propagation through the Drizzle transaction wrapper.
  const [dup] = await db
    .select({ id: schema.spaces.id })
    .from(schema.spaces)
    .where(
      and(
        eq(schema.spaces.workspaceId, input.workspaceId),
        eq(schema.spaces.slug, input.slug),
      ),
    );
  if (dup) return { ok: false, code: 'duplicate_slug' };
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.spaces)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          slug: input.slug,
          icon: input.icon ?? null,
          parentSpaceId: input.parentSpaceId ?? null,
          position: input.position ?? 0,
        })
        .returning();
      if (!row) throw new Error('createSpace: insert returned no row');
      await recordAudit(tx, {
        workspaceId: input.workspaceId,
        actorUserId: input.actorId,
        action: 'space.created',
        targetType: 'space',
        targetId: row.id,
        metadata: { slug: row.slug, name: row.name },
      });
      return { ok: true as const, space: row };
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return { ok: false, code: 'duplicate_slug' };
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  // Walk `.cause` because Drizzle's transaction wraps the driver error.
  let cursor: unknown = err;
  for (let i = 0; i < 6 && cursor; i++) {
    if (
      cursor &&
      typeof cursor === 'object' &&
      'code' in cursor &&
      (cursor as { code: string }).code === '23505'
    ) {
      return true;
    }
    cursor = (cursor as { cause?: unknown })?.cause;
  }
  return false;
}

export type UpdateSpaceInput = {
  spaceId: string;
  workspaceId: string;
  actorId: string;
  name?: string;
  icon?: string | null;
  position?: number;
};

export async function updateSpace(
  db: PostgresJsDatabase<typeof schema>,
  input: UpdateSpaceInput,
): Promise<schema.Space | null> {
  const patch: Partial<schema.NewSpace> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.position !== undefined) patch.position = input.position;
  if (Object.keys(patch).length === 0) {
    const [row] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, input.spaceId));
    return row ?? null;
  }
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.spaces)
      .set(patch)
      .where(eq(schema.spaces.id, input.spaceId))
      .returning();
    if (!row) return null;
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorId,
      action: 'space.updated',
      targetType: 'space',
      targetId: row.id,
      metadata: { changes: Object.keys(patch) },
    });
    return row;
  });
}

export async function deleteSpace(
  db: PostgresJsDatabase<typeof schema>,
  input: { spaceId: string; workspaceId: string; actorId: string },
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(schema.spaces)
      .where(eq(schema.spaces.id, input.spaceId))
      .returning();
    if (!row) return false;
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorId,
      action: 'space.deleted',
      targetType: 'space',
      targetId: row.id,
      metadata: { slug: row.slug, name: row.name },
    });
    return true;
  });
}

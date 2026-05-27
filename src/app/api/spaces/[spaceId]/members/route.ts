import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole, type WorkspaceContext } from '@/lib/auth/require-role';
import { requireSpaceAccess } from '@/lib/spaces/access';

const PostSchema = z.object({
  userId: z.uuid(),
  role: z.enum(['owner', 'admin', 'editor', 'viewer']),
});

/**
 * Existence-hiding admin gate: the caller must be a workspace `admin` AND the
 * space must live in the active workspace. Cross-workspace spaceId → 404.
 */
async function gateAdmin(spaceId: string): Promise<{ ctx: WorkspaceContext } | { res: Response }> {
  const ctx = await requireRole('admin');
  const access = await requireSpaceAccess(getDb(), {
    spaceId,
    userId: ctx.userId,
    minRole: 'admin',
    workspaceId: ctx.workspaceId,
  });
  if (!access.ok) {
    return {
      res: NextResponse.json(
        { error: access.code },
        { status: access.code === 'not_found' ? 404 : 403 },
      ),
    };
  }
  return { ctx };
}

export async function GET(
  _req: Request,
  ctxArg: { params: Promise<{ spaceId: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const { spaceId } = await ctxArg.params;
    const access = await requireSpaceAccess(getDb(), {
      spaceId,
      userId: ctx.userId,
      minRole: 'viewer',
      workspaceId: ctx.workspaceId,
    });
    if (!access.ok) {
      return NextResponse.json(
        { error: access.code },
        { status: access.code === 'not_found' ? 404 : 403 },
      );
    }
    const rows = await getDb()
      .select({
        userId: schema.spaceMembers.userId,
        role: schema.spaceMembers.role,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.spaceMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.spaceMembers.userId))
      .where(eq(schema.spaceMembers.spaceId, spaceId));
    return NextResponse.json({ members: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  req: Request,
  ctxArg: { params: Promise<{ spaceId: string }> },
): Promise<Response> {
  try {
    const { spaceId } = await ctxArg.params;
    const gate = await gateAdmin(spaceId);
    if ('res' in gate) return gate.res;
    const parsed = PostSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    await getDb().transaction(async (tx) => {
      await tx
        .insert(schema.spaceMembers)
        .values({
          spaceId,
          userId: parsed.data.userId,
          role: parsed.data.role,
        })
        .onConflictDoUpdate({
          target: [schema.spaceMembers.spaceId, schema.spaceMembers.userId],
          set: { role: parsed.data.role },
        });
      await recordAudit(tx, {
        workspaceId: gate.ctx.workspaceId,
        actorUserId: gate.ctx.userId,
        action: 'space.member_added',
        targetType: 'space_member',
        targetId: spaceId,
        metadata: { userId: parsed.data.userId, role: parsed.data.role },
      });
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  req: Request,
  ctxArg: { params: Promise<{ spaceId: string }> },
): Promise<Response> {
  try {
    const { spaceId } = await ctxArg.params;
    const gate = await gateAdmin(spaceId);
    if ('res' in gate) return gate.res;
    const userId = new URL(req.url).searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }
    await getDb().transaction(async (tx) => {
      const deleted = await tx
        .delete(schema.spaceMembers)
        .where(
          and(eq(schema.spaceMembers.spaceId, spaceId), eq(schema.spaceMembers.userId, userId)),
        )
        .returning({ userId: schema.spaceMembers.userId });
      if (deleted.length > 0) {
        await recordAudit(tx, {
          workspaceId: gate.ctx.workspaceId,
          actorUserId: gate.ctx.userId,
          action: 'space.member_removed',
          targetType: 'space_member',
          targetId: spaceId,
          metadata: { userId },
        });
      }
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function toErrorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'unknown' },
    { status: 500 },
  );
}

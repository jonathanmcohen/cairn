import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { getDatabaseWithMeta } from '@/lib/databases/get';

type Ctx = { params: Promise<{ databaseId: string }> };

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const { databaseId } = await params;
    const meta = await getDatabaseWithMeta(getDb(), { databaseId, workspaceId: ctx.workspaceId });
    if (!meta) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(meta);
  } catch (err) {
    if (err instanceof HttpError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

const PatchInput = z.object({
  name: z.string().min(1).max(200).optional(),
});

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const { databaseId } = await params;
    const meta = await getDatabaseWithMeta(getDb(), { databaseId, workspaceId: ctx.workspaceId });
    if (!meta) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const parsed = PatchInput.parse(await req.json());
    const values: { name?: string } = {};
    if (parsed.name !== undefined) values.name = parsed.name;
    const [updated] = await getDb()
      .update(schema.databases)
      .set(values)
      .where(eq(schema.databases.id, databaseId))
      .returning();
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof HttpError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const { databaseId } = await params;
    const meta = await getDatabaseWithMeta(getDb(), { databaseId, workspaceId: ctx.workspaceId });
    if (!meta) return NextResponse.json({ error: 'not found' }, { status: 404 });
    await getDb()
      .update(schema.databases)
      .set({ archivedAt: new Date() })
      .where(eq(schema.databases.id, databaseId));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof HttpError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

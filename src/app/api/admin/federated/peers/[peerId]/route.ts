import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { deletePeer, setPeerEnabled } from '@/lib/search/peer-admin';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({ enabled: z.boolean() });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ peerId: string }> },
): Promise<Response> {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { peerId } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const ok = await setPeerEnabled(getDb(), {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    peerId,
    enabled: parsed.data.enabled,
  });
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ peerId: string }> },
): Promise<Response> {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { peerId } = await params;
  const ok = await deletePeer(getDb(), {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    peerId,
  });
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

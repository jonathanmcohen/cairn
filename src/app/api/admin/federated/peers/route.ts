import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { createPeer, listPeers } from '@/lib/search/peer-admin';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(128),
  baseUrl: z.url(),
  sharedSecret: z.string().min(16).max(512),
});

export async function GET(): Promise<Response> {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ peers: await listPeers(getDb(), ctx.workspaceId) });
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const peer = await createPeer(getDb(), {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    name: parsed.data.name,
    baseUrl: parsed.data.baseUrl,
    sharedSecret: parsed.data.sharedSecret,
  });
  return NextResponse.json({ peer }, { status: 201 });
}

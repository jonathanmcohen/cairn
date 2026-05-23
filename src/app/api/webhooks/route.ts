import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { createWebhook } from '@/lib/webhooks/admin';
import { assertPublicUrl } from '@/lib/webhooks/ssrf';

const WEBHOOK_EVENTS = [
  'page.created',
  'page.updated',
  'page.deleted',
  'row.created',
  'row.updated',
  'row.deleted',
] as const;

const CreateWebhook = z.object({
  url: z.url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    // The secret is shown only at creation and never re-rendered after.
    const rows = await getDb()
      .select({
        id: schema.webhooks.id,
        url: schema.webhooks.url,
        events: schema.webhooks.events,
        active: schema.webhooks.active,
        createdAt: schema.webhooks.createdAt,
      })
      .from(schema.webhooks)
      .where(eq(schema.webhooks.workspaceId, ctx.workspaceId))
      .orderBy(desc(schema.webhooks.createdAt));
    return NextResponse.json({ webhooks: rows });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const parsed = CreateWebhook.parse(await req.json());
    // Reject internal targets at creation time (the authoritative guard also
    // runs at delivery; this surfaces the error to the form early).
    await assertPublicUrl(parsed.url);
    const { webhook, secret } = await createWebhook(getDb(), {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      url: parsed.url,
      events: parsed.events,
    });
    return NextResponse.json({ secret, webhook }, { status: 201 });
  } catch (err) {
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
}

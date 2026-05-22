import { and, arrayContains, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { signBody } from './sign';
import { assertPublicUrl } from './ssrf';

export type WebhookEvent =
  | 'page.created'
  | 'page.updated'
  | 'page.deleted'
  | 'row.created'
  | 'row.updated'
  | 'row.deleted'
  | 'comment.created';

const MAX_ATTEMPTS = 3;

/** Canonical, signed-over JSON. Keep field order stable so signatures match. */
export function canonicalBody(event: WebhookEvent, payload: unknown): string {
  return JSON.stringify({ event, data: payload });
}

/**
 * Fan an event out to active hooks subscribed to it: insert one `pending`
 * delivery per hook, then schedule delivery OFF the request path via
 * setImmediate. Never awaited by the caller — mutation latency is unaffected.
 * Failures here must never throw into the mutation, so the whole body is
 * guarded; a logged error is the worst case.
 */
export async function emit(
  event: WebhookEvent,
  workspaceId: string,
  payload: unknown,
): Promise<void> {
  try {
    const db = getDb();
    const subscribed = await db
      .select({ id: schema.webhooks.id })
      .from(schema.webhooks)
      .where(
        and(
          eq(schema.webhooks.workspaceId, workspaceId),
          eq(schema.webhooks.active, true),
          // `events @> ARRAY[event]` — the hook subscribes to this event.
          arrayContains(schema.webhooks.events, [event]),
        ),
      );
    if (subscribed.length === 0) return;

    const inserted = await db
      .insert(schema.webhookDeliveries)
      .values(
        subscribed.map((h) => ({
          webhookId: h.id,
          event,
          payload: payload as never,
          status: 'pending',
        })),
      )
      .returning({ id: schema.webhookDeliveries.id });

    for (const { id } of inserted) {
      // Off the request path. Swallow rejections — status is tracked in the row.
      setImmediate(() => {
        void deliver(id).catch(() => {});
      });
    }
  } catch (err) {
    // Emit must never break the mutation it hangs off of.
    console.error('[webhooks] emit failed', err);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const defaultBackoff = (attempt: number) => 2 ** (attempt - 1) * 1000; // 1s, 2s, 4s

/**
 * Deliver a single queued delivery: SSRF-guard the URL, POST the signed body,
 * retry up to MAX_ATTEMPTS with exponential backoff, and record the outcome.
 * `delayMs` is injectable so tests don't actually wait.
 */
export async function deliver(
  deliveryId: string,
  opts: { delayMs?: (attempt: number) => number } = {},
): Promise<void> {
  const db = getDb();
  const backoff = opts.delayMs ?? defaultBackoff;

  const [row] = await db
    .select({
      delivery: schema.webhookDeliveries,
      url: schema.webhooks.url,
      secret: schema.webhooks.secret,
    })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.webhooks, eq(schema.webhookDeliveries.webhookId, schema.webhooks.id))
    .where(eq(schema.webhookDeliveries.id, deliveryId))
    .limit(1);
  if (!row || row.delivery.status === 'success') return;

  const body = canonicalBody(row.delivery.event as WebhookEvent, row.delivery.payload);
  const signature = signBody(row.secret, body);

  let attempts = 0;
  let lastStatus: number | null = row.delivery.lastStatus ?? null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    try {
      await assertPublicUrl(row.url); // re-checked every attempt (DNS may change)
      const res = await fetch(row.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cairn-Signature': signature,
          'X-Cairn-Event': row.delivery.event,
          'User-Agent': 'Cairn-Webhooks/0.5',
        },
        body,
      });
      lastStatus = res.status;
      if (res.ok) {
        await db
          .update(schema.webhookDeliveries)
          .set({ status: 'success', attempts, lastStatus, deliveredAt: new Date() })
          .where(eq(schema.webhookDeliveries.id, deliveryId));
        return;
      }
    } catch (err) {
      console.error(`[webhooks] delivery ${deliveryId} attempt ${attempt} error`, err);
      lastStatus = null; // network/SSRF error — no HTTP status
    }
    if (attempt < MAX_ATTEMPTS) await sleep(backoff(attempt));
  }

  await db
    .update(schema.webhookDeliveries)
    .set({ status: 'failed', attempts, lastStatus })
    .where(eq(schema.webhookDeliveries.id, deliveryId));
}

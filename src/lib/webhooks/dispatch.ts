import { and, arrayContains, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { evaluateRules } from '@/lib/automation/dispatcher';
import { type CairnChatEvent, translateToSlack } from '@/lib/chat/translate-slack';
import { translateToDiscord } from '@/lib/chat/translate-discord';
import { recordPostedMessage } from '@/lib/chat/posted-log';
import { logger } from '@/lib/observability/logger';
import { incWebhook } from '@/lib/observability/metrics';
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
 * v0.9.0 G7 P36 — translate to a kind-specific body. `generic` is the canonical
 * v0.5 path; `slack`/`discord` run the payload through the translators. If the
 * payload doesn't fit the chat-event shape we fall back to canonical so the
 * delivery still ships (no dropped notifications for shape mismatches).
 */
function bodyForKind(kind: string, event: WebhookEvent, payload: unknown): string {
  if (kind !== 'slack' && kind !== 'discord') return canonicalBody(event, payload);
  if (event !== 'page.created' && event !== 'page.updated' && event !== 'comment.created') {
    return canonicalBody(event, payload);
  }
  // The translators are pure transforms over `{event, data}`; the data shape
  // must include a `.page` object. If the payload doesn't conform, drop back
  // to canonical instead of throwing — dispatch must not lose deliveries.
  const data = payload as { page?: unknown } | null;
  if (!data || typeof data !== 'object' || !('page' in data)) {
    return canonicalBody(event, payload);
  }
  const chatEvent = { event, data } as CairnChatEvent;
  if (kind === 'slack') return JSON.stringify(translateToSlack(chatEvent));
  return JSON.stringify(translateToDiscord(chatEvent));
}

/**
 * v0.9.0 G7 P36 — after a 2xx delivery to a slack/discord hook, parse the
 * response and record a `chat_posted_messages` row mapping
 * `(platform, channel, thread_ts|message_id) → page` so an inbound reply
 * (Task 6) resolves back. Skips quietly if the response shape doesn't include
 * the platform message id we need.
 */
async function recordOutboundPostedMessage(
  db: ReturnType<typeof getDb>,
  input: {
    response: Response;
    kind: 'slack' | 'discord';
    workspaceId: string;
    payload: unknown;
    platformMetadata: Record<string, unknown> | null;
    targetUrl: string;
  },
): Promise<void> {
  // Slack chat.postMessage / response_url responses include `{ok, ts, channel}`.
  // Discord webhook executes return the Message object {id, channel_id, ...}
  // only when the URL has `?wait=true`. If neither is present, give up.
  let messageId: string | null = null;
  let threadTs: string | null = null;
  let channelId: string | null = null;
  try {
    const resp = (await input.response.clone().json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (resp) {
      if (input.kind === 'slack') {
        const ts = typeof resp.ts === 'string' ? resp.ts : null;
        const channel = typeof resp.channel === 'string' ? resp.channel : null;
        messageId = ts;
        threadTs = ts;
        channelId = channel;
      } else {
        const id = typeof resp.id === 'string' ? resp.id : null;
        const channel = typeof resp.channel_id === 'string' ? resp.channel_id : null;
        messageId = id;
        channelId = channel;
      }
    }
  } catch {
    // ignore parse errors — fall through to null and skip below.
  }

  // Operators may set channel_id in platform_metadata so we can still pin posts
  // to a channel even when the platform response omits it.
  if (!channelId) {
    const meta = input.platformMetadata as { channel_id?: string } | null;
    channelId = typeof meta?.channel_id === 'string' ? meta.channel_id : input.targetUrl;
  }

  const pageId = (input.payload as { page?: { id?: string } } | null)?.page?.id;
  if (!messageId || !pageId) return; // Not enough to log; bail out quietly.

  await recordPostedMessage(db, {
    workspaceId: input.workspaceId,
    pageId,
    platform: input.kind,
    channelId,
    messageId,
    threadTs,
  });
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
    if (subscribed.length > 0) {
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
    }

    // Fan the same event into the automation rules engine, off the request
    // path. Rules engine failures are isolated — they cannot break webhook
    // delivery. Mirrors v0.6 P11 email send.
    setImmediate(() => {
      void evaluateRules(event, workspaceId, payload).catch(() => {});
    });
  } catch (err) {
    // Emit must never break the mutation it hangs off of.
    logger.error(
      { err: err instanceof Error ? { message: err.message, name: err.name } : err },
      '[webhooks] emit failed',
    );
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
      kind: schema.webhooks.kind,
      platformMetadata: schema.webhooks.platformMetadata,
      workspaceId: schema.webhooks.workspaceId,
    })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.webhooks, eq(schema.webhookDeliveries.webhookId, schema.webhooks.id))
    .where(eq(schema.webhookDeliveries.id, deliveryId))
    .limit(1);
  if (!row || row.delivery.status === 'success') return;

  const event = row.delivery.event as WebhookEvent;
  // v0.9.0 G7 P36 — when kind is slack/discord the body is platform-shaped.
  // The HMAC still signs the EXACT bytes we POST, so the signature header
  // remains meaningful even on platforms that ignore unknown headers.
  const body = bodyForKind(row.kind ?? 'generic', event, row.delivery.payload);
  const signature = signBody(row.secret, body);

  let attempts = 0;
  let lastStatus: number | null = row.delivery.lastStatus ?? null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    const attemptStart = performance.now();
    let outcome: 'success' | 'failed' = 'failed';
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
        outcome = 'success';
        await db
          .update(schema.webhookDeliveries)
          .set({ status: 'success', attempts, lastStatus, deliveredAt: new Date() })
          .where(eq(schema.webhookDeliveries.id, deliveryId));
        incWebhook({
          event: row.delivery.event,
          outcome,
          durationSec: (performance.now() - attemptStart) / 1000,
        });
        // v0.9.0 G7 P36 — record the posted-message log row so an inbound
        // reply (Task 6) can resolve back to (page, parentComment). Non-fatal:
        // if the response shape is unexpected, we just skip — the user can
        // still see the message in Slack/Discord, only inbound resolution
        // suffers.
        if (row.kind === 'slack' || row.kind === 'discord') {
          await recordOutboundPostedMessage(db, {
            response: res,
            kind: row.kind,
            workspaceId: row.workspaceId,
            payload: row.delivery.payload,
            platformMetadata: row.platformMetadata,
            targetUrl: row.url,
          }).catch((err) => {
            logger.warn(
              {
                deliveryId,
                err: err instanceof Error ? { message: err.message, name: err.name } : err,
              },
              '[chat] posted-log write failed',
            );
          });
        }
        return;
      }
    } catch (err) {
      logger.warn(
        {
          deliveryId,
          attempt,
          err: err instanceof Error ? { message: err.message, name: err.name } : err,
        },
        '[webhooks] delivery attempt error',
      );
      lastStatus = null; // network/SSRF error — no HTTP status
    }
    // Record outcome for the attempt (success path already returned above).
    incWebhook({
      event: row.delivery.event,
      outcome,
      durationSec: (performance.now() - attemptStart) / 1000,
    });
    if (attempt < MAX_ATTEMPTS) await sleep(backoff(attempt));
  }

  await db
    .update(schema.webhookDeliveries)
    .set({ status: 'failed', attempts, lastStatus })
    .where(eq(schema.webhookDeliveries.id, deliveryId));
}

import type { Notification } from '@/db/schema/notifications';
import { env } from '@/lib/env';
import { assertPublicUrl } from '@/lib/webhooks/ssrf';

/** A rendered email: subject line + plain-text body + minimal inline-styled HTML. */
export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

/** Per-notification-type copy. Keyed by `notifications.type`; falls back for unknowns. */
const COPY: Record<string, { verb: string; subject: string }> = {
  mention: { verb: 'mentioned you', subject: 'You were mentioned' },
  comment_reply: { verb: 'replied to your comment', subject: 'New reply to your comment' },
  // v0.9.0 G3 P19 — daily flashcards-due reminder.
  flashcards_due: {
    verb: 'has flashcards due for review',
    subject: 'Flashcards due for review',
  },
  // v0.9.9 Plan I (#195) — approval / status / lock event copy.
  page_approval: { verb: 'made an approval decision on a page', subject: 'Page approval decision' },
  page_status: { verb: 'changed the status of a page', subject: 'Page status changed' },
  page_lock: { verb: 'changed the lock state of a page', subject: 'Page lock changed' },
};

const FALLBACK_COPY = { verb: 'sent you a notification', subject: 'New notification' };

function copyFor(type: string): { verb: string; subject: string } {
  return COPY[type] ?? FALLBACK_COPY;
}

/** Escape the five XML-significant characters so user-derived text is HTML-safe. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the deep link for a notification and run it through the SSRF guard.
 * Links are anchored off NEXTAUTH_URL. Throws (via assertPublicUrl) if the
 * resulting host resolves to a private/invalid address.
 */
export async function linkFor(n: Notification): Promise<string> {
  const p = n.payload as { pageId?: string; commentId?: string };
  const base = env().NEXTAUTH_URL.replace(/\/+$/, '');
  // v0.9.0 G3 P19 — flashcards_due notifications have no pageId; link to the
  // study session route instead.
  let url: string;
  if (n.type === 'flashcards_due') {
    url = `${base}/flashcards/study`;
  } else if (p.commentId) {
    url = `${base}/pages/${p.pageId}#comment-${p.commentId}`;
  } else {
    url = `${base}/pages/${p.pageId}`;
  }
  await assertPublicUrl(url);
  return url;
}

/** Render a single per-event notification email. */
export async function renderNotificationEmail(n: Notification): Promise<RenderedEmail> {
  const { verb, subject } = copyFor(n.type);
  const link = await linkFor(n);

  const text = `Someone ${verb} in Cairn.\n\nView it here: ${link}\n`;

  const html = [
    '<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5">',
    `<p style="margin:0 0 16px">Someone ${escapeHtml(verb)} in Cairn.</p>`,
    `<p style="margin:0 0 16px"><a href="${escapeHtml(link)}" style="color:#2563eb;text-decoration:underline">View it</a></p>`,
    '</div>',
  ].join('');

  return { subject, text, html };
}

/**
 * Render a single digest email batching multiple notifications. Each entry
 * links to its own target; every link is SSRF-guarded.
 */
export async function renderDigestEmail(notifications: Notification[]): Promise<RenderedEmail> {
  const count = notifications.length;
  const noun = count === 1 ? 'notification' : 'notifications';
  const subject = `${count} new ${noun} in Cairn`;

  const items = await Promise.all(
    notifications.map(async (n) => {
      const { verb } = copyFor(n.type);
      const link = await linkFor(n);
      return { verb, link };
    }),
  );

  const text = [
    `You have ${count} new ${noun} in Cairn:`,
    '',
    ...items.map((i) => `- Someone ${i.verb}: ${i.link}`),
    '',
  ].join('\n');

  const html = [
    '<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5">',
    `<p style="margin:0 0 16px">You have ${count} new ${escapeHtml(noun)} in Cairn:</p>`,
    '<ul style="margin:0 0 16px;padding-left:20px">',
    ...items.map(
      (i) =>
        `<li style="margin:0 0 8px">Someone ${escapeHtml(i.verb)}: <a href="${escapeHtml(i.link)}" style="color:#2563eb;text-decoration:underline">view</a></li>`,
    ),
    '</ul>',
    '</div>',
  ].join('');

  return { subject, text, html };
}

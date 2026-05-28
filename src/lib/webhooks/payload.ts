/**
 * v0.9.0 G1 P6 — webhook payload builder for page.* events.
 *
 * Encrypted pages have no plaintext server-side; any consumer expecting
 * `body` / `contentText` / `content` to be populated must be told the page
 * is opaque to the server. This helper normalizes the outbound shape so the
 * dispatcher never accidentally leaks ciphertext or includes stale plaintext
 * fields when `page.encrypted === true`.
 *
 * Today the page emitters only pass `{id, title}` (see lib/pages/create.ts,
 * update.ts, delete.ts), so the legacy shape is already minimal. This helper
 * is the forward-compatible insertion point for future enrichment without
 * silently re-introducing a plaintext-leak hazard. Fail-closed: if `encrypted`
 * is unknown, default to redacted.
 */

export type PageEventInput = {
  id: string;
  title: string;
  encrypted?: boolean | null;
  content?: unknown;
  contentText?: string | null;
};

export type PageEventPayload = {
  page: { id: string; title: string; encrypted: boolean };
  body: unknown | null;
};

export function buildPageWebhookPayload(input: {
  event: 'page.created' | 'page.updated' | 'page.deleted';
  page: PageEventInput;
}): PageEventPayload {
  const { page } = input;
  // Fail-closed: anything that isn't strictly `false` is treated as encrypted.
  // (Undefined, null, true → redact.)
  const isEncrypted = page.encrypted !== false;
  if (isEncrypted) {
    return {
      page: { id: page.id, title: page.title, encrypted: true },
      body: null,
    };
  }
  return {
    page: { id: page.id, title: page.title, encrypted: false },
    body: page.content ?? null,
  };
}

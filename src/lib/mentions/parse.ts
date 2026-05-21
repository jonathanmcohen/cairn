// Mention storage convention: `@[Display Name](userId)`.
// The label may contain anything except a literal `]`; the id is the
// parenthesized token. We accept UUID-shaped ids (the only ids we mint).
const MENTION_RE =
  /@\[[^\]]+\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

/**
 * Extract the userIds referenced as `@[Name](userId)` mention tokens in `body`.
 * Deduped, in first-seen order. Malformed tokens (missing/empty/non-uuid id)
 * are ignored.
 */
export function extractMentions(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(MENTION_RE)) {
    const id = m[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

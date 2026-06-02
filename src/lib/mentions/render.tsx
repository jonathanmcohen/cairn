import { Fragment, type ReactNode } from 'react';

// Mention storage convention (mirrors src/lib/mentions/parse.ts): `@[Name](uuid)`.
// The label may contain anything except a literal `]`; the id must be UUID-shaped
// (the only ids we mint). A capturing global regex lets us walk text + tokens.
const MENTION_RE =
  /@\[([^\]]+)\]\((?:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))\)/g;

/**
 * #72 — read-path mention pill. Renders an inert `<span class="mention">`
 * mirroring the editor's read-only mention render (mention-readonly-extension.ts
 * + mention.css), so a comment-body `@[Name](uuid)` token reads as `@Name`
 * styled identically to mentions inside page content. Not a link (comments
 * never linked mentions); `data-mention-id` is carried for parity + future use.
 */
export function MentionPill({ id, label }: { id: string; label: string }) {
  return (
    <span className="mention" data-mention-id={id} title={label}>
      @{label}
    </span>
  );
}

/**
 * #72 — tokenize a comment body string on the `@[Name](uuid)` pattern into an
 * array of React nodes: plain-text runs interleaved with `<MentionPill>`s.
 * Malformed tokens (missing/empty/non-uuid id) are left as literal text because
 * they don't match the regex. Handles 0, 1, and N mentions plus adjacent text.
 *
 * The caller renders the result inside a `whitespace-pre-wrap` container, so we
 * keep raw text runs verbatim (no trimming/normalization).
 */
export function renderCommentBody(body: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  // matchAll over a fresh regex (the literal has the global flag; matchAll
  // requires it and does not share lastIndex state across calls).
  for (const match of body.matchAll(MENTION_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      nodes.push(<Fragment key={`t${key}`}>{body.slice(lastIndex, start)}</Fragment>);
      key += 1;
    }
    const label = match[1] ?? '';
    const id = match[2] ?? '';
    nodes.push(<MentionPill key={`m${key}`} id={id} label={label} />);
    key += 1;
    lastIndex = start + match[0].length;
  }
  if (lastIndex < body.length) {
    nodes.push(<Fragment key={`t${key}`}>{body.slice(lastIndex)}</Fragment>);
  }
  return nodes;
}

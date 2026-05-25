/**
 * Prefix-convention parser/formatter for `pages.icon` (kept as `text NULL`).
 *
 *   "emoji::<unicode>"       → { kind: 'emoji', value: '<unicode>' }
 *   "file::<uuid>"           → { kind: 'file',  value: '<uuid>'    }
 *   "<anything else non-empty>" → { kind: 'emoji', value: '<anything>' }  (legacy)
 *
 * The legacy fallback exists so existing rows (created before this change wrote
 * raw emoji into the column) continue to render. Anything that LOOKS like a
 * file:: but lacks a uuid suffix falls back to the emoji bucket — the renderer
 * will fail to load it as an image, the user will simply see no icon, no crash.
 */

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type ParsedIcon = { kind: 'emoji'; value: string } | { kind: 'file'; value: string };

export function parseIcon(stored: string | null): ParsedIcon | null {
  if (!stored) return null;
  if (stored.startsWith('emoji::')) {
    return { kind: 'emoji', value: stored.slice('emoji::'.length) };
  }
  if (stored.startsWith('file::')) {
    const value = stored.slice('file::'.length);
    if (UUID_RE.test(value)) return { kind: 'file', value };
    // Bad file:: payload → treat the whole string as a legacy emoji-ish blob.
    return { kind: 'emoji', value: stored };
  }
  // Legacy: raw emoji written directly to the column before the prefix-rule.
  return { kind: 'emoji', value: stored };
}

export function formatIcon(icon: ParsedIcon): string {
  return `${icon.kind}::${icon.value}`;
}

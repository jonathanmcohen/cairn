import type { SearchFilters } from '@/lib/pages/search';

/** Known operator keys. Adding one here updates parser + chip-builder + dropdown. */
export const OPERATOR_KEYS = ['from', 'in', 'before', 'after', 'tag', 'type', 'status'] as const;
export type OperatorKey = (typeof OPERATOR_KEYS)[number];

export type Operator = { key: OperatorKey; value: string };

export type ParseWarning =
  | { kind: 'unknown_key'; token: string }
  | { kind: 'empty_value'; key: string };

export type ParseResult = {
  free: string;
  ops: Operator[];
  warnings: ParseWarning[];
};

const UUID_RE = /^[0-9a-f-]{36}$/i;

function isKnownKey(k: string): k is OperatorKey {
  return (OPERATOR_KEYS as readonly string[]).includes(k);
}

/**
 * Tokenize on top-level whitespace, but keep `key:"quoted value"` and
 * `key:'quoted value'` intact and respect backslash-escape of `:` and quote
 * chars. Returns raw tokens; structural parsing happens in parseQuery.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\\' && i + 1 < input.length) {
      // Preserve the escape for downstream value-unescape.
      buf += ch + input[i + 1];
      i++;
      continue;
    }
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (/\s/.test(ch ?? '')) {
      if (buf.length > 0) {
        tokens.push(buf);
        buf = '';
      }
      continue;
    }
    buf += ch;
  }
  if (buf.length > 0) tokens.push(buf);
  return tokens;
}

/** Strip surrounding quotes + decode backslash escapes. */
function unquote(raw: string): string {
  let s = raw;
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    s = s.slice(1, -1);
  }
  return s.replace(/\\(.)/g, '$1');
}

/**
 * Split a token into `key:value` if the part before the first *unescaped*
 * colon is a known operator key. Returns null when the token has no colon, an
 * empty value, or a key that isn't in OPERATOR_KEYS — those tokens are passed
 * through as free text. Tokens with a recognized-but-unmappable key are
 * surfaced via the {warnings} channel from the caller.
 */
function splitKV(token: string): { key: string; value: string } | null {
  // First unescaped colon position.
  let i = 0;
  while (i < token.length) {
    if (token[i] === '\\') {
      i += 2;
      continue;
    }
    if (token[i] === ':') break;
    i++;
  }
  if (i === 0 || i >= token.length) return null;
  const key = token.slice(0, i);
  const value = token.slice(i + 1);
  if (value.length === 0) return null;
  return { key, value };
}

/**
 * Parse a search input into structured operators + residual free text.
 * Pure + dependency-free; no IO. The caller wires `filters` into the v0.6 P22
 * search route.
 */
export function parseQuery(input: string): ParseResult {
  const ops: Operator[] = [];
  const warnings: ParseWarning[] = [];
  const freeParts: string[] = [];

  for (const token of tokenize(input)) {
    const kv = splitKV(token);
    if (!kv) {
      freeParts.push(token);
      continue;
    }
    if (!isKnownKey(kv.key)) {
      warnings.push({ kind: 'unknown_key', token });
      continue;
    }
    ops.push({ key: kv.key, value: unquote(kv.value) });
  }

  return { free: freeParts.join(' '), ops, warnings };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Project a list of operators into the SearchFilters shape consumed by
 * src/lib/pages/search.ts compileSearchFilters + the /api/search route.
 * Operators that don't map cleanly (e.g. `tag`, `status` pre-lifecycle wire,
 * `in`) are intentionally dropped here — they're surfaced separately to the
 * caller via the raw `ops` list for future projection.
 */
export function filtersFromOperators(ops: Operator[]): SearchFilters {
  const filters: SearchFilters = {};
  const dateRange: { from?: string; to?: string } = {};
  const types: ('page' | 'db_row')[] = [];

  for (const op of ops) {
    switch (op.key) {
      case 'from':
        // Only project when the value is a uuid; username resolution is a
        // route-layer concern (looks up users.email → users.id then sets
        // filters.author). Leaving non-uuid `from` unprojected here keeps the
        // pure-function contract.
        if (UUID_RE.test(op.value)) filters.author = op.value;
        break;
      case 'after':
        if (ISO_DATE_RE.test(op.value)) dateRange.from = op.value;
        break;
      case 'before':
        if (ISO_DATE_RE.test(op.value)) dateRange.to = op.value;
        break;
      case 'type':
        if (op.value === 'page' || op.value === 'db_row') types.push(op.value);
        break;
      // `tag`, `status`, `in` are accepted but not yet projected: the
      // tag-index lookup is a follow-up; status wires once lifecycle is in
      // the SearchFilters shape; `in` is a space-id lookup (P11).
      case 'tag':
      case 'status':
      case 'in':
        break;
    }
  }

  if (dateRange.from || dateRange.to) filters.dateRange = dateRange;
  if (types.length > 0) filters.types = types;
  return filters;
}

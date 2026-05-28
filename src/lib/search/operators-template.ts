export type Template = { name: string; expansion: string };

export type ExpandWarning =
  | { kind: 'unknown_template'; name: string }
  | { kind: 'nested_template'; name: string };

export type ExpandResult = { text: string; warnings: ExpandWarning[] };

/**
 * Walk `input` left-to-right. Outside quotes, every `@name` (name = letters,
 * digits, underscore, hyphen) is replaced with the named template's
 * `expansion` string, or — if the expansion itself contains `@` — left as-is
 * with a `nested_template` warning. Unknown templates are left as-is with an
 * `unknown_template` warning.
 *
 * Quoted content is opaque: `"@anything"` is preserved verbatim. This matches
 * the parser's tokenizer so the round-trip parseQuery(expandTemplates(x)) is
 * predictable.
 */
export function expandTemplates(input: string, templates: Template[]): ExpandResult {
  const byName = new Map(templates.map((t) => [t.name, t.expansion]));
  const out: string[] = [];
  const warnings: ExpandWarning[] = [];
  let i = 0;
  let quote: '"' | "'" | null = null;

  while (i < input.length) {
    const ch = input[i] ?? '';
    if (quote) {
      out.push(ch);
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch as '"' | "'";
      out.push(ch);
      i++;
      continue;
    }
    if (ch === '@') {
      // Match name.
      let j = i + 1;
      while (j < input.length && /[\w-]/.test(input[j] ?? '')) j++;
      const name = input.slice(i + 1, j);
      if (name.length === 0) {
        out.push('@');
        i++;
        continue;
      }
      const exp = byName.get(name);
      if (exp === undefined) {
        warnings.push({ kind: 'unknown_template', name });
        out.push(input.slice(i, j));
        i = j;
        continue;
      }
      if (exp.includes('@')) {
        warnings.push({ kind: 'nested_template', name });
        out.push(input.slice(i, j));
        i = j;
        continue;
      }
      out.push(exp);
      i = j;
      continue;
    }
    out.push(ch);
    i++;
  }
  return { text: out.join(''), warnings };
}

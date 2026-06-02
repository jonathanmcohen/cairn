import { Extension, markInputRule } from '@tiptap/core';

// #260 / #261 — markdown shorthand input rules that DELETE their delimiters.
// `markInputRule` replaces the matched range with the marked text taken from the
// LAST capture group (the inner text), so the `**`/`~~` markers are stripped,
// not left as literals. The optional leading `(?:^|\s)` keeps a preceding space
// (StarterKit's own rules use the same anchor) while still firing mid-line.
export const BOLD_INPUT_RE = /(?:^|\s)(\*\*([^*]+)\*\*)$/;
export const STRIKE_INPUT_RE = /(?:^|\s)(~~([^~]+)~~)$/;

/** Remove a wrapping delimiter pair (e.g. `**x**` → `x`). Pure helper. */
export function stripDelimiters(text: string, delimiter: string): string {
  if (
    text.startsWith(delimiter) &&
    text.endsWith(delimiter) &&
    text.length >= delimiter.length * 2
  ) {
    return text.slice(delimiter.length, text.length - delimiter.length);
  }
  return text;
}

/**
 * Standalone extension (not a `Mark.extend`) so the `markInputRule` `type`
 * resolves to the real `MarkType` from the live schema — `Mark.extend`'s
 * `addInputRules` `this.type` is typed as `NodeType` in TipTap 3, which
 * conflicts with `markInputRule`'s `MarkType` parameter. Looking the mark types
 * up by name from `editor.schema.marks` sidesteps that mismatch and keeps
 * StarterKit's own Bold/Strike marks intact.
 */
export const MarkdownMarkInputRules = Extension.create({
  name: 'cairnMarkdownMarkInputRules',
  addInputRules() {
    const rules = [];
    const bold = this.editor.schema.marks.bold;
    const strike = this.editor.schema.marks.strike;
    if (bold) rules.push(markInputRule({ find: BOLD_INPUT_RE, type: bold }));
    if (strike) rules.push(markInputRule({ find: STRIKE_INPUT_RE, type: strike }));
    return rules;
  },
});

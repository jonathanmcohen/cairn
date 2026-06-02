// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';
import {
  BOLD_INPUT_RE,
  STRIKE_INPUT_RE,
  stripDelimiters,
} from '@/components/editor/marks/markdown-input-rules';

describe('markdown input rules (#260 / #261)', () => {
  it('bold regex matches **x** and strike regex matches ~~x~~', () => {
    expect(BOLD_INPUT_RE.test('**x**')).toBe(true);
    expect(STRIKE_INPUT_RE.test('~~x~~')).toBe(true);
    // mid-line (after a space) still fires
    expect(BOLD_INPUT_RE.test('hello **world**')).toBe(true);
    expect(STRIKE_INPUT_RE.test('hello ~~world~~')).toBe(true);
  });

  it('does not match unbalanced delimiters', () => {
    expect(BOLD_INPUT_RE.test('**x')).toBe(false);
    expect(STRIKE_INPUT_RE.test('~~x')).toBe(false);
  });

  it('stripDelimiters removes the wrapping markers', () => {
    expect(stripDelimiters('**x**', '**')).toBe('x');
    expect(stripDelimiters('~~y~~', '~~')).toBe('y');
    expect(stripDelimiters('plain', '**')).toBe('plain');
  });

  it('baseExtensions registers the markdown input-rules extension + bold/strike marks', () => {
    const exts = baseExtensions();
    // StarterKit's bold + strike marks remain (the input-rules extension targets
    // them by schema name).
    expect(exts.find((e) => e.name === 'starterKit')).toBeTruthy();
    const rulesExt = exts.find((e) => e.name === 'cairnMarkdownMarkInputRules');
    expect(rulesExt).toBeTruthy();
    // The extension defines addInputRules; calling it against a stub editor whose
    // schema exposes bold + strike marks returns a non-empty rule array.
    const addInputRules = rulesExt?.config.addInputRules as
      | ((this: unknown) => unknown[])
      | undefined;
    const ctx = {
      editor: { schema: { marks: { bold: { name: 'bold' }, strike: { name: 'strike' } } } },
    };
    const rules = addInputRules?.call(ctx);
    expect(Array.isArray(rules)).toBe(true);
    expect((rules as unknown[]).length).toBe(2);
  });
});

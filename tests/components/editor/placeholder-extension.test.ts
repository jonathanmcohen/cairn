import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';

describe('empty-page placeholder (#84)', () => {
  it('configures the Placeholder extension with the slash hint', () => {
    const ext = baseExtensions();
    const placeholder = ext.find((e) => e.name === 'placeholder');
    expect(placeholder).toBeTruthy();
    // The callback resolves to the slash hint for a paragraph and 'Heading' for headings.
    const cb = placeholder?.options?.placeholder as
      | ((p: { node: { type: { name: string } } }) => string)
      | undefined;
    expect(typeof cb).toBe('function');
    expect(cb?.({ node: { type: { name: 'paragraph' } } })).toBe("Type '/' for commands");
    expect(cb?.({ node: { type: { name: 'heading' } } })).toBe('Heading');
  });

  it('ships the CSS contract that paints data-placeholder via ::before', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/editor/blocks.css'), 'utf8');
    // The extension only adds the class + attribute; the visible text is CSS.
    expect(css).toMatch(/\.is-empty(::|:)?.*::before/s);
    expect(css).toContain('content: attr(data-placeholder)');
  });
});

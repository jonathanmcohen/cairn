// tests/styles/editor-block-spacing.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('editor block spacing token (#141)', () => {
  it('defines --cairn-block-gap token at 6px', () => {
    expect(css).toMatch(/--cairn-block-gap:\s*6px/);
  });
});

describe('editor block spacing rules (#141)', () => {
  // All rules MUST be scoped to the editable surface
  // (.ProseMirror[contenteditable="true"]) so they do not leak to the public
  // /p/* read-only reader, which also carries the runtime .ProseMirror class.
  it('scopes the block-gap rule to the editable .ProseMirror surface', () => {
    expect(css).toContain('.ProseMirror[contenteditable="true"] > * + *');
    expect(css).toContain('var(--cairn-block-gap');
  });

  it('does NOT add bare (unscoped) .ProseMirror margin rules (would hit public reader)', () => {
    // guard against regression to the leaky selector
    expect(css).not.toMatch(/\.ProseMirror >\s*\*\s*\+\s*\*/);
  });

  it('adds h1 margin-bottom on the editable surface', () => {
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] h1[^}]*margin-bottom/s);
  });

  it('adds h2 top + bottom margins on the editable surface', () => {
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] h2[^}]*margin-top/s);
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] h2[^}]*margin-bottom/s);
  });

  it('adds h3 top + bottom margins on the editable surface', () => {
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] h3[^}]*margin-top/s);
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] h3[^}]*margin-bottom/s);
  });

  it('zeros paragraph margin on the editable surface', () => {
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] p[^}]*margin:\s*0/s);
  });

  it('adds ul/ol left indent on the editable surface', () => {
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] [uo]l[^}]*padding-left/s);
  });

  it('adds blockquote and pre vertical margins on the editable surface', () => {
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] blockquote[^}]*margin/s);
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] pre[^}]*margin/s);
  });
});

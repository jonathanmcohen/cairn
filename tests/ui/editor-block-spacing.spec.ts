/**
 * Plan C3 (#141) — editor block spacing.
 * Source-assertion slice. The block-gap token + margin rules are scoped to the
 * EDITABLE surface (.ProseMirror[contenteditable="true"]) only, so they never
 * leak to the public /p/* read-only reader (which also carries the runtime
 * .ProseMirror class via ReadOnlyView at contenteditable="false").
 * See docs/superpowers/plans/v0.9.14/plan-C-ui-density-polish.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('Plan C3 #141 — editor block spacing', () => {
  it('globals.css defines --cairn-block-gap at 6px', () => {
    expect(css).toMatch(/--cairn-block-gap:\s*6px/);
  });

  it('.ProseMirror block-flow margins applied (h1/h2/h3 + p/ul/ol/li/blockquote/pre)', () => {
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] h1[^}]*margin-bottom/s);
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] h2[^}]*margin-top/s);
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] h3[^}]*margin-top/s);
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] p[^}]*margin:\s*0/s);
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] [uo]l[^}]*padding-left/s);
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] li[^}]*margin/s);
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] blockquote[^}]*margin/s);
    expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] pre[^}]*margin/s);
  });

  it('margins are scoped to .ProseMirror[contenteditable="true"] (editor only, NOT public /p/* reader)', () => {
    expect(css).toContain('.ProseMirror[contenteditable="true"] > * + *');
    expect(css).toContain('var(--cairn-block-gap');
  });

  it('no bare unscoped .ProseMirror margin rule exists (would leak to read-only reader)', () => {
    expect(css).not.toMatch(/\.ProseMirror >\s*\*\s*\+\s*\*/);
  });
});

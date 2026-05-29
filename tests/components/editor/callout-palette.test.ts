import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/components/editor/code-highlight.css'), 'utf8');

describe('callout palette', () => {
  it('default note callout uses a neutral (non-blue) background', () => {
    const note = css.match(/\.callout-note\s*\{([^}]*)\}/)?.[1] ?? '';
    // neutral slate/muted, NOT the saturated blue 219 234 254 it had in round-1
    expect(note).not.toContain('219 234 254');
    expect(note).toMatch(/var\(--muted\)|241 245 249|226 232 240/);
  });

  it('info callout carries the blue accent', () => {
    const info = css.match(/\.callout-info\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(info).toMatch(/219 234 254|59 130 246/);
  });
});

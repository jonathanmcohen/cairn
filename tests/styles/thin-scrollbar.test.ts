import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('thin scrollbar utility (#210/#211)', () => {
  const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');
  it('defines a themed thin scrollbar utility', () => {
    expect(css).toContain('.cairn-thin-scrollbar');
    expect(css).toContain('scrollbar-width: thin');
    expect(css).toContain('scrollbar-gutter: stable');
    expect(css).toContain('::-webkit-scrollbar');
    expect(css).toContain('overscroll-behavior: contain');
  });
});

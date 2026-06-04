import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// #262 — Tailwind typography's generated quote glyphs bled onto blockquote/li.
// We assert on the authored CSS text (jsdom doesn't compute Tailwind `content`):
// the prose scope must emit quotes ONLY for inline <q> and explicitly clear them
// on blockquote/li.
const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('prose generated-quote scoping (#262)', () => {
  it('emits open/close-quote only for inline q', () => {
    expect(css).toContain('.prose q::before');
    expect(css).toContain('open-quote');
    expect(css).toContain('.prose q::after');
    expect(css).toContain('close-quote');
  });

  it('clears generated quotes on blockquote and list items', () => {
    expect(css).toMatch(/\.prose blockquote::before/);
    expect(css).toMatch(/\.prose li::before/);
    expect(css).toMatch(/content:\s*none/);
  });
});

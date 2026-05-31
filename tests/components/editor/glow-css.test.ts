import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// #110/#133 — regression guard: the global focus ring must not match the
// editing surface or the slash popup, or the saturated --ring outline paints
// a stuck viewport edge-glow after slash-menu teardown.
describe('viewport glow CSS scoping (#110/#133)', () => {
  const css = readFileSync(resolve(__dirname, '../../../src/app/globals.css'), 'utf8');

  it('excludes .ProseMirror and the slash popup from the global :focus-visible ring', () => {
    // The base ring rule carries a :not() that excludes the editing surfaces.
    expect(css).toMatch(/:focus-visible:not\([^)]*\.ProseMirror[^)]*\)/);
    expect(css).toMatch(/cairn-slash-popup/);
  });

  it('explicitly suppresses the outline on the editing surface + slash popup', () => {
    expect(css).toMatch(/\.ProseMirror[\s\S]*?:focus-visible[\s\S]*?outline:\s*none/);
  });
});

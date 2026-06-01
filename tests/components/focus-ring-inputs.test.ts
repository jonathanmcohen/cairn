import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILES = [
  'src/components/databases/cell-editor.tsx',
  'src/components/databases/relation-cell.tsx',
  'src/components/databases/property-panel.tsx',
  'src/components/search-palette.tsx',
];

describe('focus-suppressing inputs restore a visible ring', () => {
  for (const f of FILES) {
    const src = readFileSync(join(process.cwd(), f), 'utf8');
    it(`${f} has no bare outline-hidden/outline-none on inputs`, () => {
      // No `outline-hidden`/`outline-none` may appear WITHOUT a paired ring.
      // We assert the file no longer contains the bare tokens at all; every
      // occurrence is replaced with focus-visible:ring-* utilities.
      expect(src).not.toMatch(/\boutline-hidden\b/);
      expect(src).not.toMatch(/(?<!focus-visible:)\boutline-none\b/);
    });
    it(`${f} declares a focus-visible ring`, () => {
      expect(src).toMatch(/focus-visible:ring-2/);
    });
  }
});

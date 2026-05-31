import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILES = [
  'src/components/sidebar-footer-nav.tsx',
  'src/components/sidebar-recents.tsx',
  'src/components/sidebar/pinned-section.tsx',
  'src/components/sidebar-favorites.tsx',
  'src/components/editor/suggestion-toolbar.tsx',
];

describe('bare-hover links get a keyboard focus ring', () => {
  for (const f of FILES) {
    it(`${f} declares a focus-visible ring`, () => {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      expect(src).toMatch(/focus-visible:ring-2/);
    });
  }
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILES = [
  'src/components/databases/table-view.tsx',
  'src/components/databases/list-view.tsx',
  'src/components/databases/calc-footer-row.tsx',
];

describe('db view files use themed Select (#38)', () => {
  for (const rel of FILES) {
    it(`${rel} has no raw <select`, () => {
      const text = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(text).not.toMatch(/<select[\s>]/);
    });
  }
});

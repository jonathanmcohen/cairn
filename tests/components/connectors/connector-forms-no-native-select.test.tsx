import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILES = [
  'src/components/connectors/sheets-config-form.tsx',
  'src/components/connectors/csv-config-form.tsx',
  'src/components/connectors/airtable-config-form.tsx',
];

describe('connector forms use themed Select (#38)', () => {
  for (const rel of FILES) {
    it(`${rel} has no raw <select`, () => {
      const text = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(text).not.toMatch(/<select[\s>]/);
    });
  }
});

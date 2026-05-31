import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILES = [
  'src/app/(app)/settings/workspace/danger/danger-zone.tsx',
  'src/app/(app)/settings/workspace/invites/invites-manager.tsx',
  'src/app/(app)/settings/workspace/members/members-table.tsx',
  'src/app/(app)/settings/workspace/spaces/spaces-manager.tsx',
  'src/app/(app)/settings/workspace/export-static-site/export-static-site-form.tsx',
  'src/components/import/import-form.tsx',
  'src/components/settings/api-keys-manager.tsx',
];

describe('settings/import/dev forms use themed Select (#38)', () => {
  for (const rel of FILES) {
    it(`${rel} has no raw <select`, () => {
      const text = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(text).not.toMatch(/<select[\s>]/);
    });
  }
});

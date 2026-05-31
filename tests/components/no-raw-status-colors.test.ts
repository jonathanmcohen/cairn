import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILES = [
  'src/app/(app)/settings/workspace/general/settings-form.tsx',
  'src/components/settings/webhooks-manager.tsx',
  'src/components/admin/audit-viewer.tsx',
  'src/app/(app)/settings/admin/siem/forwarders-view.tsx',
  'src/components/connectors/airtable-config-form.tsx',
  'src/components/automation/builder/test-panel.tsx',
];

// Raw Tailwind palette utilities for red/green (any shade), as className tokens.
const RAW = /\b(?:text|bg|border)-(?:red|green)-\d{2,3}\b/;

describe('no raw red/green status colors in banner components', () => {
  for (const f of FILES) {
    it(`${f} uses semantic tokens only`, () => {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      expect(src).not.toMatch(RAW);
    });
  }
});

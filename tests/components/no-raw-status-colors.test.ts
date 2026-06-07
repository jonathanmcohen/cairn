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
  // v0.9.14 Plan U (U1) — diff/status color token swaps.
  'src/components/editor/suggestions-drawer.tsx',
  'src/components/pages/version-history.tsx',
  'src/components/account/profile-form.tsx',
];

// Raw Tailwind palette utilities for red/green (any shade), as className tokens.
const RAW = /\b(?:text|bg|border|decoration)-(?:red|green)-\d{2,3}\b/;

// Orphaned dark-mode overrides on red/green — the success/destructive tokens
// are already dark-mode-aware, so any leftover `dark:` red/green class is a bug.
const ORPHAN_DARK = /\bdark:(?:text|bg|border|decoration)-(?:red|green)-\d{2,3}\b/;

describe('no raw red/green status colors in banner components', () => {
  for (const f of FILES) {
    it(`${f} uses semantic tokens only`, () => {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      expect(src).not.toMatch(RAW);
    });

    it(`${f} has no orphaned dark: red/green overrides`, () => {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      expect(src).not.toMatch(ORPHAN_DARK);
    });
  }
});

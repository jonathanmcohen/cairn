/**
 * Plan C4 (K2 #216) — new pages default to Draft status (regression; shipped).
 *
 * The behavioral contract is already locked by the Testcontainers integration
 * test tests/lib/pages/create-default-status.test.ts, which asserts both the
 * draft default for a fresh workspace AND the admin override path. This slice
 * is a fast source-assertion guard against the fallback silently changing away
 * from 'draft' (the security-adjacent default: new pages are not auto-published
 * before review).
 * See docs/superpowers/plans/v0.9.14/plan-C-ui-density-polish.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(process.cwd(), 'src/lib/pages/create.ts'), 'utf8');

describe('Plan C4 — new page default Draft (regression)', () => {
  it('createPage with no status falls back to workspace defaultPageStatus ?? "draft"', () => {
    expect(src).toMatch(/ws\?\.defaultPageStatus\s*\?\?\s*'draft'/);
  });
});

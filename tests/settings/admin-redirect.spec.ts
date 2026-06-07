/**
 * Plan E4 (#5 / stale-deploy #121) — /settings/admin redirect (regression; shipped).
 * Asserts that /settings/admin redirects to /settings/admin/audit and NOT to
 * /settings/admin/members or the stale pre-v0.8 /settings/admin/audit-log path.
 *
 * Uses a static source scan (not a live HTTP request): the Next.js App Router
 * redirect() is a server-side throw, so inspecting the route source is the
 * fastest zero-infra regression guard.
 * See docs/superpowers/plans/v0.9.14/plan-E-notifications-settings.md.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Plan E4 #5 — /settings/admin redirect (regression)', () => {
  const src = readFileSync(resolve('src/app/(app)/settings/admin/page.tsx'), 'utf8');

  it('redirects to /settings/admin/audit', () => {
    expect(src).toContain("redirect('/settings/admin/audit')");
  });

  it('does not redirect to /settings/admin/members', () => {
    expect(src).not.toContain("redirect('/settings/admin/members')");
  });

  it('does not redirect to /settings/admin/audit-log (stale pre-v0.8 path)', () => {
    expect(src).not.toContain("redirect('/settings/admin/audit-log')");
  });
});

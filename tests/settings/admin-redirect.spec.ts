/**
 * Item #5 (v0.9.18) — /settings/admin is a real landing page, not a redirect.
 *
 * History: the page-level redirect('/settings/admin/audit') was DEAD CODE —
 * the proxy's EXACT_REDIRECTS 308'd /settings/admin to
 * /settings/workspace/members before the page component ever ran (the layer
 * the original regression spec missed). v0.9.18 removes both redirects and
 * ships a real admin index. This spec pins BOTH layers:
 *   1. proxy (resolveSettingsRedirect): /settings/admin must NOT redirect;
 *   2. page source: renders the landing, contains no redirect() at all.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSettingsRedirect } from '@/lib/settings/redirects';

describe('item #5 — /settings/admin landing page (both layers)', () => {
  const src = readFileSync(resolve('src/app/(app)/settings/admin/page.tsx'), 'utf8');

  it('proxy layer: /settings/admin does not redirect', () => {
    expect(resolveSettingsRedirect('/settings/admin')).toBeNull();
  });

  it('proxy layer: admin children still resolve under admin (audit unchanged)', () => {
    expect(resolveSettingsRedirect('/settings/admin/audit')).toBeNull();
    expect(resolveSettingsRedirect('/settings/admin/webhooks')).toBeNull();
  });

  it('page renders a landing — no redirect() of any kind', () => {
    expect(src).not.toContain('redirect(');
    expect(src).toContain('adminLanding.title');
  });

  it('page is admin-gated', () => {
    expect(src).toContain("requireRole('admin')");
  });

  it('landing links every admin child surface', () => {
    for (const href of [
      '/settings/admin/audit',
      '/settings/admin/users',
      '/settings/admin/api-keys',
      '/settings/admin/webhooks',
      '/settings/admin/sso',
      '/settings/admin/mfa',
      '/settings/admin/encryption',
      '/settings/admin/siem',
      '/settings/admin/chat-bridge',
      '/settings/admin/federated',
      '/settings/admin/upgrade',
    ]) {
      expect(src).toContain(href);
    }
  });

  it('no stale pre-v0.8 audit-log path anywhere in the page', () => {
    expect(src).not.toContain('audit-log');
  });
});

import { describe, expect, it } from 'vitest';
import { resolveSettingsRedirect } from '@/lib/settings/redirects';

describe('resolveSettingsRedirect', () => {
  it('redirects bare /settings to /settings/account/profile', () => {
    expect(resolveSettingsRedirect('/settings')).toBe('/settings/account/profile');
  });

  it('redirects flat profile to /settings/account/profile', () => {
    expect(resolveSettingsRedirect('/settings/profile')).toBe('/settings/account/profile');
  });

  it.each([
    ['/settings/admin', '/settings/workspace/members'],
    ['/settings/admin/invites', '/settings/workspace/invites'],
    ['/settings/admin/settings', '/settings/workspace/general'],
    ['/settings/admin/danger', '/settings/workspace/danger'],
    ['/settings/admin/audit', '/settings/admin/audit'], // unchanged (stays under admin)
    ['/settings/api-keys', '/settings/developer/api-keys'],
    ['/settings/automation', '/settings/developer/automation'],
    ['/settings/connectors', '/settings/developer/connectors'],
    ['/settings/import', '/settings/developer/import'],
    ['/settings/export', '/settings/developer/export'],
    ['/settings/webhooks', '/settings/admin/webhooks'],
    ['/settings/developer', '/settings/developer/api-keys'],
    ['/settings/notifications', '/settings/notifications'], // unchanged
    ['/settings/security', '/settings/security'], // unchanged
  ])('redirects %s → %s', (from, to) => {
    expect(resolveSettingsRedirect(from)).toBe(to === from ? null : to);
  });

  it('preserves sub-segments under /settings/connectors/[id]/conflicts', () => {
    expect(resolveSettingsRedirect('/settings/connectors/abc123/conflicts')).toBe(
      '/settings/developer/connectors/abc123/conflicts',
    );
  });

  it('preserves sub-segments under /settings/admin/webhooks/[id]/deliveries', () => {
    // Already lives under /settings/admin — no redirect needed.
    expect(resolveSettingsRedirect('/settings/admin/webhooks/wh1/deliveries')).toBeNull();
  });

  it('redirects /settings/webhooks/wh1/deliveries → /settings/admin/webhooks/wh1/deliveries', () => {
    expect(resolveSettingsRedirect('/settings/webhooks/wh1/deliveries')).toBe(
      '/settings/admin/webhooks/wh1/deliveries',
    );
  });

  it('returns null for non-settings paths', () => {
    expect(resolveSettingsRedirect('/pages/abc')).toBeNull();
    expect(resolveSettingsRedirect('/api/inbox')).toBeNull();
    expect(resolveSettingsRedirect('/')).toBeNull();
  });

  it('returns null for already-new paths', () => {
    expect(resolveSettingsRedirect('/settings/account/profile')).toBeNull();
    expect(resolveSettingsRedirect('/settings/workspace/members')).toBeNull();
    expect(resolveSettingsRedirect('/settings/developer/api-keys')).toBeNull();
  });
});

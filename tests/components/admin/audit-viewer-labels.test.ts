import { describe, expect, it } from 'vitest';
import { actionLabel } from '@/components/admin/audit-viewer';
import { AUDIT_ACTIONS } from '@/lib/audit/actions';

describe('audit viewer labels (#259, #265)', () => {
  it('labels every documented page.permission_* + ownership event', () => {
    for (const a of [
      'page.permission_granted',
      'page.permission_changed',
      'page.permission_revoked',
      'page.permission_invited',
      'page.permission_invite_revoked',
      'page.ownership_transferred',
    ] as const) {
      expect(AUDIT_ACTIONS).toContain(a);
      expect(actionLabel(a)).not.toBe(a);
    }
  });

  it('every audit action resolves to a non-identity label', () => {
    for (const a of AUDIT_ACTIONS) {
      expect(actionLabel(a)).not.toBe(a);
    }
  });
});

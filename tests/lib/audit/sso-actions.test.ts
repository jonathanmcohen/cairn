import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '@/lib/audit/actions';

describe('AUDIT_ACTIONS — v0.9.0 SSO additions', () => {
  it('includes sso.idp.created', () => {
    expect(AUDIT_ACTIONS).toContain('sso.idp.created');
  });
  it('includes sso.idp.updated', () => {
    expect(AUDIT_ACTIONS).toContain('sso.idp.updated');
  });
  it('includes sso.idp.deleted', () => {
    expect(AUDIT_ACTIONS).toContain('sso.idp.deleted');
  });
  it('includes sso.scim.token.minted', () => {
    expect(AUDIT_ACTIONS).toContain('sso.scim.token.minted');
  });
  it('includes sso.scim.token.revoked', () => {
    expect(AUDIT_ACTIONS).toContain('sso.scim.token.revoked');
  });
});

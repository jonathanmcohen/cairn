/** Documented audit-action vocabulary (spec §2.27, §3 G1). Append-only history of sensitive events. */
export const AUDIT_ACTIONS = [
  'member.role_changed',
  'member.removed',
  'invite.created',
  'invite.revoked',
  'page.published',
  'page.unpublished',
  'page.share_changed',
  'page.deleted',
  'page.version_restored',
  'database.deleted',
  'api_key.created',
  'api_key.revoked',
  'webhook.created',
  'webhook.deleted',
  'webhook.secret_rotated',
  'template.created',
  'workspace.settings_changed',
  'workspace.ownership_transferred',
  'workspace.deleted',
  // v0.7.0 G1 P5 — personal-access-token + page-ACL events.
  'pat.created',
  'pat.revoked',
  'pat.expired',
  // v0.9.0 G1 P9 — PAT quota exceeded (daily / monthly / per-scope per-minute).
  'pat.quota_exceeded',
  // v0.9.0 G1 P10 — admin cleared a PAT's day+month rollup rows.
  'pat.quota_reset',
  'page_acl.created',
  'page_acl.changed',
  'page_acl.removed',
  // v0.8.0 G3 P8 — quick-capture inbox events (spec §5.5).
  'inbox.captured',
  'inbox.triaged',
  // v0.9.0 G1 P1 — SSO bundle (OIDC + SAML config CRUD + SCIM token lifecycle).
  // Consumers: P2 (OIDC adapter), P3 (SAML adapter), P4 (SCIM endpoint + admin UI).
  'sso.idp.created',
  'sso.idp.updated',
  'sso.idp.deleted',
  'sso.scim.token.minted',
  'sso.scim.token.revoked',
  // v0.9.0 G1 P5-P7 — E2E encryption lifecycle.
  'e2e.keypair.created',
  'e2e.page.encrypted',
  'e2e.workspace.encrypted',
  // v0.9.0 G1 P7 — workspace-wide WSK roster + rekey lifecycle.
  'e2e.workspace.member_added',
  'e2e.workspace.member_removed',
  'e2e.workspace.rekey_started',
  'e2e.workspace.rekey_completed',
  // v0.9.0 G1 P8 — WebAuthn passkey + step-up + admin-enforce events.
  'mfa.passkey_added',
  'mfa.passkey_removed',
  'mfa.passkey_used',
  'mfa.stepup_required',
  'mfa.policy_changed',
  // v0.9.0 G2 P11 — Spaces CRUD + per-space membership.
  'space.created',
  'space.updated',
  'space.deleted',
  'space.member_added',
  'space.member_removed',
  'page.moved_space',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditTargetType =
  | 'page'
  | 'database'
  | 'workspace'
  | 'member'
  | 'api_key'
  | 'webhook'
  | 'invite'
  | 'template'
  // v0.7.0 G1 P5 — new target types for PATs + ACL rows.
  | 'personal_access_token'
  | 'page_acl'
  // v0.9.0 G1 P8 — passkey credential rows + workspace MFA policy rows.
  | 'webauthn_credential'
  | 'mfa_policy'
  // v0.9.0 G2 P11 — spaces CRUD + per-space ACL rows.
  | 'space'
  | 'space_member';

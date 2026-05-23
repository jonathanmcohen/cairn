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
  'page_acl.created',
  'page_acl.changed',
  'page_acl.removed',
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
  | 'page_acl';

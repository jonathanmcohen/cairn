/** Documented audit-action vocabulary (spec §2.27). Append-only history of sensitive events. */
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
  'template.created',
  'workspace.settings_changed',
  'workspace.ownership_transferred',
  'workspace.deleted',
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
  | 'template';

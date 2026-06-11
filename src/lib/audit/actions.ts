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
  // v0.9.9 Plan B (#259) — page-level ownership transfer (stored 'owner' tier).
  'page.ownership_transferred',
  // v0.9.9 Plan B (#259, #265) — documented per-page permission vocabulary. The
  // legacy page_acl.* events above stay emitted-and-recognized for SIEM
  // back-compat; these are the human-facing names the audit UI labels and the
  // ACL grant/invite/transfer code emits.
  'page.permission_invited',
  'page.permission_invite_revoked',
  'page.permission_granted',
  'page.permission_changed',
  'page.permission_revoked',
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
  'mfa.recovery_codes_regenerated',
  // v0.9.0 G2 P11 — Spaces CRUD + per-space membership.
  'space.created',
  'space.updated',
  'space.deleted',
  'space.member_added',
  'space.member_removed',
  'page.moved_space',
  // v0.9.0 G2 P12 — Workspace-pinned pages (admin-curated top-of-sidebar).
  'workspace.pin_added',
  'workspace.pin_removed',
  'workspace.pins_reordered',
  // v0.9.0 G2 P13 — Trash retention purge (auto = cron, manual = admin click).
  'trash.purged_auto',
  'trash.purged_manual',
  // v0.9.0 G2 P14 — Page lock. `page.locked` / `page.unlocked` cover the
  // happy path; `page.auto_unlocked` fires when the cron sweep clears an
  // expired `locked_until`; `page.unlock_overridden_by_admin` records an
  // admin force-unlock of someone else's lock (self-unlock by an admin who
  // also happens to be the locker stays a plain `page.unlocked`).
  'page.locked',
  'page.unlocked',
  'page.auto_unlocked',
  'page.unlock_overridden_by_admin',
  // v0.9.0 G4 P23 — Tasks hub: user toggled a taskItem checkbox via /my-tasks
  // or the toggle API. metadata: { blockId, checked }.
  'task.toggled',
  // v0.9.0 G4 P26 — page lifecycle + translation linkage.
  // `page.status_changed` metadata: { from, to }. `page.translation_linked`
  // metadata: { locale, canonicalPageId }.
  'page.status_changed',
  'page.translation_linked',
  // v0.9.0 G4 P24 — page approval workflow. `page.approval_requested` records
  // an editor moving a page into review. `page.approved` /
  // `page.approval_rejected` / `page.changes_requested` record the admin's
  // signed decision; metadata carries { versionSnapshotId, signatureHmac } so
  // the audit log alone proves which version was decided on under which key.
  'page.approval_requested',
  'page.approved',
  'page.approval_rejected',
  'page.changes_requested',
  // v0.9.0 G5 P30 — admin elected to run a search that pierced workspace
  // membership (include_all_workspaces=true). metadata: { query }. Fires on
  // EVERY such call (even zero hits) because the privacy concern is the
  // query string itself, not whether it matched.
  'search.cross_workspace_admin',
  // v0.9.0 G6 P33 — fine-grained share-password events. Complement the legacy
  // `page.share_changed` (still emitted for duplication + expiresAt changes
  // and ALSO co-emitted when the password path changes, for SIEM
  // back-compat). `share.password_used` fires from /p/<slug>/verify on a
  // successful unlock — actorUserId is null because the viewer is anonymous.
  'share.password_set',
  'share.password_cleared',
  'share.password_used',
  // v0.9.0 G7 P36 — chat-bridge events (outbound post log + inbound comment
  // created + per-call signature rejection + admin install changes). Metadata
  // is scrubbed: platform + channel_id are operator-facing identifiers, never
  // raw chat payload. `chat.signature_rejected` fires on every rejected
  // request (anti-replay or wrong sig) — useful for SIEM correlation when an
  // operator's signing secret rotates incorrectly.
  'chat.outbound_posted',
  'chat.inbound_comment_created',
  'chat.signature_rejected',
  'chat.install_changed',
  // v0.9.0 G7 P37 — slash command invocations + channel-link CRUD. Metadata
  // for slash carries { command, channelId } — never the raw query/title (the
  // raw user input could contain page secrets). Channel-link events carry
  // { platform, channelId, pageId, linkMode } and target the link row id.
  'chat.slash_invoked',
  'chat.channel_linked',
  'chat.channel_unlinked',
  // v0.9.8 G6 (audit F) — full Slack/Discord OAuth install completed. Metadata:
  // { platform, externalTeamId, op, scopeCount } — counts + ids only, NEVER the
  // sealed bot token.
  'chat.oauth_installed',
  // v0.9.0 G8 P39 — meta-audit emitted when a SIEM forwarder delivery
  // exhausts its retry budget. Excluded from the SIEM dispatch hook so a
  // perpetually dead forwarder cannot create an infinite delivery loop.
  // Metadata: { forwarderId, error } — never the raw envelope or secret.
  'siem.delivery_failed',
  // v0.9.0 G8 P41 — cairn-upgrade CLI lifecycle events. Emitted by the
  // upgrade orchestrator (apply / rollback / compose wrapper). The audit
  // row's workspace_id points to the operator-chosen "admin" workspace
  // because audit_log.workspace_id is NOT NULL. Metadata:
  //  - `upgrade.applied`:     { fromVersion, toVersion, migrationCount }
  //  - `upgrade.failed`:      { fromVersion, toVersion, error }
  //  - `upgrade.rolled_back`: { snapshotPath } — operator-visible path to
  //                           the pre-upgrade dump file; never a secret.
  'upgrade.applied',
  'upgrade.failed',
  'upgrade.rolled_back',
  // v0.9.6 G8b (#70) — user revoked active sessions ("sign out everywhere").
  // metadata: { scope: 'others' | 'all', revoked } — counts only, no sid.
  'auth.sessions_revoked',
  // v0.9.8 G1 (audit item A/B) — federated-search peer management from the
  // admin console (/settings/admin/federated). metadata: { name, baseUrl }
  // on create; {} on enable/disable/delete. Never the shared secret.
  'federation.peer_created',
  'federation.peer_enabled',
  'federation.peer_disabled',
  'federation.peer_deleted',
  // v0.9.16 Plan F — MCP OAuth 2.1 authorization-server lifecycle. Metadata
  // carries ids / counts / scope-names only — NEVER the issued secret (the
  // cairn_oauth_/cairn_oart_/cairn_oac_/cairn_ocs_ prefixes are in
  // FORBIDDEN_SUBSTRINGS and would trip assertAuditMetadataClean).
  'oauth.client_registered',
  'oauth.consent_granted',
  'oauth.token_issued',
  'oauth.token_revoked',
  // v0.10.0 D3 — admin deleted a registered client app from the instance
  // registry (/settings/admin/oauth-clients). The delete cascade-revokes every
  // oauth_tokens row issued to the client. Metadata: { clientId, name,
  // revokedGrants } — ids + counts only, never a secret.
  'oauth.client_deleted',
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
  // v0.9.9 Plan B (#259) — page email-invite rows.
  | 'page_acl_invite'
  // v0.9.0 G1 P8 — passkey credential rows + workspace MFA policy rows.
  | 'webauthn_credential'
  | 'mfa_policy'
  // v0.9.0 G2 P11 — spaces CRUD + per-space ACL rows.
  | 'space'
  | 'space_member'
  // v0.9.0 G7 P36 — chat-bridge events target comments (inbound) or webhooks
  // (admin install changes).
  | 'comment'
  // v0.9.0 G7 P37 — dedicated install + channel-link target types so the
  // audit UI can render a meaningful label for slash + sync events.
  | 'chat_install'
  | 'chat_channel_link'
  // v0.9.8 G6 (audit F) — full-OAuth install rows (chat_oauth_installs table).
  | 'chat_oauth_install'
  // v0.9.8 G1 — federated-search peer rows (peer_instances table).
  | 'peer_instance'
  // v0.9.16 Plan F — MCP OAuth client + issued-token rows.
  | 'oauth_client'
  | 'oauth_token';

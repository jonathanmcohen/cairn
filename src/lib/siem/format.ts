/**
 * v0.9.0 G8 P39 — Canonical SIEM envelope.
 *
 * Every target (syslog, HTTP webhook, P40's Splunk/Datadog/S3) consumes the
 * same envelope and applies its own framing on top. Keys use snake_case so
 * Splunk HEC + Datadog Logs ingest them without a transform; the dispatcher
 * never mutates the envelope after `formatAuditEvent` returns.
 *
 * Field selection: ids, action, target, and operator-scrubbed metadata only.
 * The audit-log recorder already enforces `assertAuditMetadataClean` so secret-
 * looking values can never reach the envelope, but never trust that contract
 * blindly when adding a new field — keep the SIEM payload to ids + flags.
 */

export type AuditEventInput = {
  id: string;
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type SiemEnvelope = {
  id: string;
  timestamp: string;
  workspace_id: string;
  actor_user_id: string | null;
  action: string;
  target: { type: string; id: string } | null;
  metadata: Record<string, unknown>;
};

export function formatAuditEvent(input: AuditEventInput): SiemEnvelope {
  return {
    id: input.id,
    timestamp: input.createdAt.toISOString(),
    workspace_id: input.workspaceId,
    actor_user_id: input.actorUserId,
    action: input.action,
    target:
      input.targetType && input.targetId
        ? { type: input.targetType, id: input.targetId }
        : null,
    metadata: input.metadata,
  };
}

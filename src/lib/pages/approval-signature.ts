/**
 * v0.9.0 G4 P24 — HMAC-SHA256 approval signature.
 *
 * Pure functions (no DB / no env reads — the caller passes `secret`). The
 * canonical form is `pageId|versionSnapshotId|approverUserId|decision|
 * approvedAtISO`. `|` is forbidden in UUIDs and ISO-8601 timestamps so the
 * join is unambiguous.
 *
 * `verifyApprovalSignature` returns `false` on length / encoding mismatch
 * (instead of throwing) so callers can fold it into row-level truthy checks
 * without a defensive try/catch.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ApprovalDecision } from '@/db/schema/page-approvals';

export type { ApprovalDecision };

export type ApprovalSignatureParts = {
  pageId: string;
  versionSnapshotId: string;
  approverUserId: string;
  decision: ApprovalDecision;
  approvedAtISO: string;
};

function canonical(parts: ApprovalSignatureParts): string {
  return [
    parts.pageId,
    parts.versionSnapshotId,
    parts.approverUserId,
    parts.decision,
    parts.approvedAtISO,
  ].join('|');
}

export function signApproval(parts: ApprovalSignatureParts, secret: string): string {
  return createHmac('sha256', secret).update(canonical(parts)).digest('hex');
}

export function verifyApprovalSignature(
  parts: ApprovalSignatureParts,
  signature: string,
  secret: string,
): boolean {
  const expected = signApproval(parts, secret);
  if (expected.length !== signature.length) return false;
  let expectedBuf: Buffer;
  let actualBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expected, 'hex');
    actualBuf = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  if (expectedBuf.length !== actualBuf.length || expectedBuf.length === 0) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

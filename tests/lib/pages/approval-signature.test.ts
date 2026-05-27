/**
 * v0.9.0 G4 P24 — HMAC-SHA256 approval signature roundtrip + tamper tests.
 *
 * The signature is computed by joining canonical parts with `|` and HMAC-ing
 * under `AUTH_SECRET`. `|` is a forbidden char in UUIDs and ISO timestamps so
 * the canonical join is unambiguous. Tamper of any input field, or rotation of
 * the key, must fail verification.
 */
import { describe, expect, it } from 'vitest';
import { signApproval, verifyApprovalSignature } from '@/lib/pages/approval-signature';

const PARTS = {
  pageId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  versionSnapshotId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  approverUserId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  decision: 'approved' as const,
  approvedAtISO: '2026-05-26T12:00:00.000Z',
};

describe('approval signature', () => {
  it('sign + verify roundtrip', () => {
    const sig = signApproval(PARTS, 'test-secret');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyApprovalSignature(PARTS, sig, 'test-secret')).toBe(true);
  });

  it('detects tampered pageId', () => {
    const sig = signApproval(PARTS, 'test-secret');
    expect(
      verifyApprovalSignature(
        { ...PARTS, pageId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' },
        sig,
        'test-secret',
      ),
    ).toBe(false);
  });

  it('detects tampered decision', () => {
    const sig = signApproval(PARTS, 'test-secret');
    expect(verifyApprovalSignature({ ...PARTS, decision: 'rejected' }, sig, 'test-secret')).toBe(
      false,
    );
  });

  it('detects key rotation', () => {
    const sig = signApproval(PARTS, 'secret-A');
    expect(verifyApprovalSignature(PARTS, sig, 'secret-B')).toBe(false);
  });

  it('returns false on a non-hex / wrong-length signature without throwing', () => {
    expect(verifyApprovalSignature(PARTS, 'not-a-real-hex-signature', 'test-secret')).toBe(false);
    expect(verifyApprovalSignature(PARTS, '', 'test-secret')).toBe(false);
  });
});

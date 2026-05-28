import { describe, expect, it } from 'vitest';
import { formatAuditEvent } from '@/lib/siem/format';

describe('formatAuditEvent', () => {
  it('emits a stable envelope for a user-driven event', () => {
    const out = formatAuditEvent({
      id: 'a1',
      workspaceId: 'w1',
      actorUserId: 'u1',
      action: 'page.published',
      targetType: 'page',
      targetId: 'p1',
      metadata: { title: 'x' },
      createdAt: new Date('2026-05-26T10:00:00Z'),
    });
    expect(out).toEqual({
      id: 'a1',
      timestamp: '2026-05-26T10:00:00.000Z',
      workspace_id: 'w1',
      actor_user_id: 'u1',
      action: 'page.published',
      target: { type: 'page', id: 'p1' },
      metadata: { title: 'x' },
    });
  });

  it('emits null actor + null target for a system event', () => {
    const out = formatAuditEvent({
      id: 'a1',
      workspaceId: 'w1',
      actorUserId: null,
      action: 'trash.purged_auto',
      targetType: null,
      targetId: null,
      metadata: {},
      createdAt: new Date('2026-05-26T10:00:00Z'),
    });
    expect(out.actor_user_id).toBeNull();
    expect(out.target).toBeNull();
  });

  it('emits null target when only one of type/id is present', () => {
    const halfTyped = formatAuditEvent({
      id: 'a1',
      workspaceId: 'w1',
      actorUserId: 'u1',
      action: 'x',
      targetType: 'page',
      targetId: null,
      metadata: {},
      createdAt: new Date('2026-05-26T10:00:00Z'),
    });
    const halfIded = formatAuditEvent({
      id: 'a2',
      workspaceId: 'w1',
      actorUserId: 'u1',
      action: 'x',
      targetType: null,
      targetId: 'p1',
      metadata: {},
      createdAt: new Date('2026-05-26T10:00:00Z'),
    });
    expect(halfTyped.target).toBeNull();
    expect(halfIded.target).toBeNull();
  });
});

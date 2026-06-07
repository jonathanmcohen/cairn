/**
 * Plan E1 (#16) — notification event matrix (regression; shipped).
 * Asserts NOTIFICATION_TYPES + the schema NotificationType union cover the three
 * v0.9.9 page event types alongside the base mention/comment_reply types.
 * See docs/superpowers/plans/v0.9.14/plan-E-notifications-settings.md.
 */
import { describe, expect, it } from 'vitest';
import type { NotificationType } from '@/db/schema/notifications';
import { NOTIFICATION_TYPES } from '@/lib/email/prefs';

describe('notification event matrix', () => {
  it('NOTIFICATION_TYPES includes all three page event types', () => {
    const types: string[] = [...NOTIFICATION_TYPES];
    expect(types).toContain('page_approval');
    expect(types).toContain('page_status');
    expect(types).toContain('page_lock');
  });

  it('NOTIFICATION_TYPES includes base mention and comment_reply types', () => {
    const types: string[] = [...NOTIFICATION_TYPES];
    expect(types).toContain('mention');
    expect(types).toContain('comment_reply');
  });

  it('schema NotificationType union contains page_approval, page_status, page_lock', () => {
    // Compile-time assertion: assign all three to NotificationType to prove the union.
    const a: NotificationType = 'page_approval';
    const b: NotificationType = 'page_status';
    const c: NotificationType = 'page_lock';
    expect([a, b, c]).toHaveLength(3);
  });
});

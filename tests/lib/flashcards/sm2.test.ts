import { describe, expect, it } from 'vitest';
import { scheduleNext } from '@/lib/flashcards/sm2';

const NOW = new Date('2026-05-26T12:00:00Z');

describe('SM-2 scheduleNext', () => {
  it('grade 0 (Again) resets interval to 0 and due_at to now', () => {
    const next = scheduleNext({ ease: 2.5, interval: 7 }, 0, NOW);
    expect(next.interval).toBe(0);
    expect(next.dueAt.getTime()).toBe(NOW.getTime());
    expect(next.ease).toBeLessThan(2.5);
    expect(next.ease).toBeGreaterThanOrEqual(1.3);
  });

  it('grade 2 (Good) on first review (interval=0) → interval 1 day', () => {
    const next = scheduleNext({ ease: 2.5, interval: 0 }, 2, NOW);
    expect(next.interval).toBe(1);
    expect(next.dueAt.getTime()).toBe(NOW.getTime() + 86_400_000);
    expect(next.ease).toBeCloseTo(2.5);
  });

  it('grade 2 (Good) on second review (interval=1) → interval 6 days', () => {
    const next = scheduleNext({ ease: 2.5, interval: 1 }, 2, NOW);
    expect(next.interval).toBe(6);
    expect(next.dueAt.getTime()).toBe(NOW.getTime() + 6 * 86_400_000);
  });

  it('grade 2 (Good) on third review (interval=6, ease=2.5) → interval 15 days', () => {
    const next = scheduleNext({ ease: 2.5, interval: 6 }, 2, NOW);
    expect(next.interval).toBe(15);
  });

  it('grade 3 (Easy) increases ease', () => {
    const next = scheduleNext({ ease: 2.5, interval: 6 }, 3, NOW);
    expect(next.ease).toBeGreaterThan(2.5);
  });

  it('grade 1 (Hard) lowers ease but advances interval', () => {
    const next = scheduleNext({ ease: 2.5, interval: 6 }, 1, NOW);
    expect(next.ease).toBeLessThan(2.5);
    expect(next.ease).toBeGreaterThanOrEqual(1.3);
    expect(next.interval).toBeGreaterThan(0);
  });

  it('ease never drops below 1.3 even after many consecutive lapses', () => {
    let r: { ease: number; interval: number } = { ease: 1.3, interval: 0 };
    for (let i = 0; i < 10; i++) {
      const n = scheduleNext(r, 0, NOW);
      r = { ease: n.ease, interval: n.interval };
    }
    expect(r.ease).toBeGreaterThanOrEqual(1.3);
  });

  it('records lastReviewedAt and lastGrade on every call', () => {
    const next = scheduleNext({ ease: 2.5, interval: 0 }, 2, NOW);
    expect(next.lastReviewedAt.getTime()).toBe(NOW.getTime());
    expect(next.lastGrade).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { mountedProgress, nextMountedStep, STEPS, type TourStep } from '@/components/tour/steps';

function step(id: string): TourStep {
  return {
    id,
    anchor: `[data-tour="${id}"]`,
    titleKey: `tour.step.${id}.title`,
    bodyKey: `tour.step.${id}.body`,
    placement: 'right',
  };
}

const FIVE = [step('a'), step('b'), step('c'), step('d'), step('e')];

/** isMounted stub: only the given ids count as mounted. */
function mountedOnly(...ids: string[]): (selector: string) => boolean {
  const set = new Set(ids.map((id) => `[data-tour="${id}"]`));
  return (selector) => set.has(selector);
}

describe('nextMountedStep (F3 skip-unmounted-anchor walker)', () => {
  it('returns the immediate next step when its anchor is mounted', () => {
    expect(nextMountedStep(FIVE, 0, mountedOnly('a', 'b', 'c', 'd', 'e'))).toBe(1);
  });

  it('skips unmounted anchors forward (b and c missing → a jumps to d)', () => {
    expect(nextMountedStep(FIVE, 0, mountedOnly('a', 'd', 'e'))).toBe(3);
  });

  it('skips unmounted anchors backward (direction -1)', () => {
    expect(nextMountedStep(FIVE, 3, mountedOnly('a', 'd', 'e'), -1)).toBe(0);
  });

  it('fromIndex -1 finds the FIRST mounted step (start of tour)', () => {
    expect(nextMountedStep(FIVE, -1, mountedOnly('c', 'd'))).toBe(2);
  });

  it('returns -1 when exhausted forward', () => {
    expect(nextMountedStep(FIVE, 3, mountedOnly('a', 'd'))).toBe(-1);
  });

  it('returns -1 when exhausted backward', () => {
    expect(nextMountedStep(FIVE, 0, mountedOnly('a'), -1)).toBe(-1);
  });

  it('returns -1 when NOTHING is mounted', () => {
    expect(nextMountedStep(FIVE, -1, () => false)).toBe(-1);
  });

  it('never returns the fromIndex itself', () => {
    expect(nextMountedStep(FIVE, 2, mountedOnly('c'))).toBe(-1);
  });
});

describe('mountedProgress (counter over mounted steps only)', () => {
  it('counts all steps when everything is mounted', () => {
    expect(mountedProgress(FIVE, 0, () => true)).toEqual({ current: 1, total: 5 });
    expect(mountedProgress(FIVE, 4, () => true)).toEqual({ current: 5, total: 5 });
  });

  it('skipped anchors leave no hole in the counter', () => {
    // d unmounted → totals over {a, b, c, e}; at e the counter reads 4 / 4.
    const isMounted = mountedOnly('a', 'b', 'c', 'e');
    expect(mountedProgress(FIVE, 0, isMounted)).toEqual({ current: 1, total: 4 });
    expect(mountedProgress(FIVE, 2, isMounted)).toEqual({ current: 3, total: 4 });
    expect(mountedProgress(FIVE, 4, isMounted)).toEqual({ current: 4, total: 4 });
  });

  it('counts the current step even if its anchor just unmounted', () => {
    expect(mountedProgress(FIVE, 1, mountedOnly('a', 'c'))).toEqual({ current: 2, total: 3 });
  });
});

describe('STEPS list shape', () => {
  it('anchors are [data-tour=…] hooks and i18n keys follow tour.step.<id>.*', () => {
    expect(STEPS.length).toBeGreaterThanOrEqual(5);
    for (const s of STEPS) {
      expect(s.anchor).toMatch(/^\[data-tour="[a-z-]+"\]$/);
      expect(s.titleKey).toBe(`tour.step.${s.id}.title`);
      expect(s.bodyKey).toBe(`tour.step.${s.id}.body`);
    }
  });
});

/**
 * SM-2 spaced-repetition algorithm (v0.9.0 G3 P19).
 *
 * Pure function. Given the previous `(ease, interval)` and a 0..3 grade,
 * computes the next review state. No I/O, no clock reads — the caller passes
 * `now` so tests are fully deterministic.
 *
 *   grade 0 = Again (forgot)  → interval reset to 0, due immediately, ease −0.20
 *   grade 1 = Hard            → ease −0.15, standard interval bump
 *   grade 2 = Good            → ease unchanged, standard interval bump
 *   grade 3 = Easy            → ease +0.15, standard interval bump
 *
 * Standard interval recurrence (grade ≥ 1):
 *   - prev.interval === 0  →  1 day  (first successful review)
 *   - prev.interval === 1  →  6 days (second successful review)
 *   - otherwise            →  round(prev.interval * newEase)
 *
 * Ease is clamped to a lower bound of 1.3 so a chronically-failing card still
 * advances eventually rather than thrashing the user at the minimum interval.
 */
export type ReviewState = { ease: number; interval: number };

export type ReviewNext = {
  ease: number;
  interval: number;
  dueAt: Date;
  lastReviewedAt: Date;
  lastGrade: number;
};

const DAY_MS = 86_400_000;
const MIN_EASE = 1.3;
const EASE_DELTA: Record<0 | 1 | 2 | 3, number> = {
  0: -0.2,
  1: -0.15,
  2: 0,
  3: 0.15,
};

export function scheduleNext(
  prev: ReviewState,
  grade: 0 | 1 | 2 | 3,
  now: Date = new Date(),
): ReviewNext {
  const newEase = Math.max(MIN_EASE, prev.ease + EASE_DELTA[grade]);
  if (grade === 0) {
    return {
      ease: newEase,
      interval: 0,
      dueAt: now,
      lastReviewedAt: now,
      lastGrade: grade,
    };
  }
  let interval: number;
  if (prev.interval === 0) interval = 1;
  else if (prev.interval === 1) interval = 6;
  else interval = Math.round(prev.interval * newEase);
  return {
    ease: newEase,
    interval,
    dueAt: new Date(now.getTime() + interval * DAY_MS),
    lastReviewedAt: now,
    lastGrade: grade,
  };
}

/**
 * v0.9.8 G3 (audit item I) — deterministic exponential-backoff helper for the
 * collab token re-fetch loop. Pure: the jitter source is injected so unit
 * tests are deterministic without mocking globals. `scheduleWithBackoff`
 * wraps `setTimeout` and returns a cancel function for effect cleanup.
 */

export type BackoffConfig = {
  /** Delay for attempt 0, in ms. */
  baseMs: number;
  /** Upper cap on the exponential term, in ms (applied before jitter). */
  maxMs: number;
  /** Exponential growth factor (e.g. 2 doubles each attempt). */
  factor: number;
  /** Fraction of the capped delay added as random jitter (0..1). */
  jitterRatio: number;
};

/**
 * Production defaults: 1s base, 30s cap, doubling, ±50% jitter band. The
 * collab token TTL is 5 min (README), so a 30s cap reconnects well within a
 * token's validity once the network/DNS recovers.
 */
export const DEFAULT_COLLAB_BACKOFF: BackoffConfig = {
  baseMs: 1000,
  maxMs: 30_000,
  factor: 2,
  jitterRatio: 0.5,
};

/**
 * Compute the delay (ms) for a given 0-based retry attempt.
 * `rand` returns a value in [0,1) (default `Math.random`); injectable for
 * deterministic tests. Jitter is additive (full-jitter-band on top of the
 * capped exponential delay), so the result is in
 * `[capped, capped * (1 + jitterRatio)]`.
 */
export function computeBackoffDelay(
  attempt: number,
  config: BackoffConfig = DEFAULT_COLLAB_BACKOFF,
  rand: () => number = Math.random,
): number {
  const n = Math.max(0, Math.floor(attempt));
  const exponential = config.baseMs * config.factor ** n;
  const capped = Math.min(exponential, config.maxMs);
  const jitter = capped * config.jitterRatio * rand();
  return Math.round(capped + jitter);
}

/**
 * Schedule `callback` to run after the backoff delay for `attempt`. Returns a
 * cancel function that clears the pending timer.
 */
export function scheduleWithBackoff(
  attempt: number,
  config: BackoffConfig,
  callback: () => void,
  rand: () => number = Math.random,
): () => void {
  const delay = computeBackoffDelay(attempt, config, rand);
  const handle = setTimeout(callback, delay);
  return () => clearTimeout(handle);
}

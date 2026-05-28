/**
 * v0.9.0 G8 P39 — `siem:retry-sweep` CLI entrypoint.
 *
 * Single-instance sweep called from the scheduler every minute. Module-level
 * `isRunning` guards against an overlapping spawn — the scheduler spawns one
 * child process per due row, so under sustained back-pressure the guard would
 * be hit immediately and the second tick gets a fast no-op.
 */

import { retryPendingDeliveries } from './dispatch';

let isRunning = false;

export async function runSiemRetrySweep(): Promise<{ swept: number }> {
  if (isRunning) return { swept: 0 };
  isRunning = true;
  try {
    return await retryPendingDeliveries();
  } finally {
    isRunning = false;
  }
}

import { getDb } from '@/db/client';
import { emailEnabled } from '@/lib/email/transport';
import { type NotifyResult, notifyDueFlashcards } from './notify-due';

/**
 * CLI shim for the `flashcards:notify-due` scheduler command (v0.9.0 G3 P19).
 *
 * Exists as a thin wrapper around `notifyDueFlashcards` so the cron dispatcher
 * can `await import(...)` it without pulling in `@/db/client` at module-load
 * time (matches the trash:purge / pages:auto-unlock CLI pattern).
 *
 * v0.10.2 F3 Task D — SMTP guard + per-workspace hour:
 *   - Short-circuits (0 sent) when SMTP is not configured.
 *   - Passes the current UTC hour so only workspaces whose reminderHour
 *     matches this tick are notified.
 */
export async function runFlashcardsNotifyDueCli(): Promise<NotifyResult> {
  const db = getDb();
  if (!(await emailEnabled(db))) {
    return { notified: 0 };
  }
  const tickHour = new Date().getUTCHours();
  return notifyDueFlashcards(db, new Date(), tickHour);
}

import { getDb } from '@/db/client';
import { notifyDueFlashcards, type NotifyResult } from './notify-due';

/**
 * CLI shim for the `flashcards:notify-due` scheduler command (v0.9.0 G3 P19).
 *
 * Exists as a thin wrapper around `notifyDueFlashcards` so the cron dispatcher
 * can `await import(...)` it without pulling in `@/db/client` at module-load
 * time (matches the trash:purge / pages:auto-unlock CLI pattern).
 */
export async function runFlashcardsNotifyDueCli(): Promise<NotifyResult> {
  return notifyDueFlashcards(getDb());
}

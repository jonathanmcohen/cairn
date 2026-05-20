import { getDb } from '@/db/client';
import { env } from '@/lib/env';
import { autoPurge } from './auto-purge';

/** Fire-and-forget; failures are logged but do not throw. */
export function maybePurge(): void {
  void autoPurge(getDb(), { retentionDays: env().CAIRN_TRASH_RETENTION_DAYS }).catch((err) => {
    console.error('autoPurge failed:', err);
  });
}

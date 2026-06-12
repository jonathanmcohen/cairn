'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

/**
 * #1 (P0) — settings RSC error boundary. Without it, a thrown server-component
 * error (e.g. a 42703 from a lagging column on a stale deploy) renders Next's
 * bare digest screen with no recovery. This boundary catches anything thrown
 * by a settings child and offers a recoverable "couldn't load — retry" that
 * re-attempts the segment via `reset()`.
 */
export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  useEffect(() => {
    // Surface the underlying error to the console/observability so ops can
    // still see the real cause (e.g. the missing-migration 42703) even though
    // the user sees a friendly recoverable message.
    console.error('settings segment error:', error);
  }, [error]);

  return (
    <section className="mx-auto max-w-md space-y-3 rounded-lg border p-6 text-center">
      <h2 className="font-semibold text-lg">{t('settings.error.title')}</h2>
      <p className="text-muted-foreground text-sm">{t('settings.error.body')}</p>
      <Button type="button" onClick={() => reset()} className="min-h-11">
        {t('settings.error.retry')}
      </Button>
    </section>
  );
}

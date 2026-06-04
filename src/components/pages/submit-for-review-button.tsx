'use client';

/**
 * G16 #163 — editor-facing "Submit for review" control.
 *
 * POSTs `{ action: 'request' }` to the existing approval route, which flips the
 * page into the `review` status. Gated by the caller to editors on a
 * draft/published page (the only statuses `transitionStatus` allows into
 * review).
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

export function SubmitForReviewButton({ pageId }: { pageId: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}/approval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'request' }),
      });
      if (!res.ok) {
        setError(t('pages.review.error'));
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="default" disabled={busy} onClick={() => void submit()}>
        {busy ? t('pages.review.submitting') : t('pages.review.submit')}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

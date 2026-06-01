'use client';

import { GraduationCap } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useT } from '@/lib/i18n/provider';

/**
 * G14 (#161) — a PERSISTENT entry to the flashcards study session. The existing
 * ReviewDueCounter only appears when cards are due; this link is always shown so
 * the study experience is reachable from the nav at any time.
 */
export function StudyLink(): React.JSX.Element {
  const t = useT();
  return (
    <Link
      href={'/flashcards/study' as Route}
      className="mb-2 flex min-h-11 items-center gap-2 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent/50"
    >
      <GraduationCap aria-hidden="true" className="size-4" />
      {t('flashcards.study.link')}
    </Link>
  );
}

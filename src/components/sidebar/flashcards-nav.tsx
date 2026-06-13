'use client';

import { ChevronDown, ChevronRight, GraduationCap } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.10.2 F1 Task D — the consolidated Flashcards sidebar nav. Replaces the two
 * standalone footer rows (`ReviewDueCounter` + `StudyLink`): an always-visible
 * expandable parent linking to the `/flashcards` overview, with children for
 * Due now / Manage / Orphans, plus a due-count badge.
 *
 * The badge is fetched once on mount from `/api/flashcards/due` and fails OPEN
 * (any error → count 0 → no badge), mirroring the S9 count pills — a broken
 * count endpoint can never take the footer nav down. The PARENT row is always
 * rendered (fixing ReviewDueCounter's render-null-at-0); only the badge is
 * conditional on count > 0.
 */

const ROW_CLASS =
  'flex min-h-[28px] flex-1 items-center gap-2 rounded px-2 py-1 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:py-1.5';

const CHILD_CLASS =
  'flex min-h-[28px] items-center gap-2 rounded py-1 pr-2 pl-8 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:py-1.5';

function useDueCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    try {
      fetch('/api/flashcards/due', { credentials: 'include', cache: 'no-store' })
        .then((res) => (res.ok ? (res.json() as Promise<{ due?: unknown }>) : null))
        .then((data) => {
          if (!cancelled && data && Array.isArray(data.due)) setCount(data.due.length);
        })
        .catch(() => {
          // fail-open: no badge
        });
    } catch {
      // fail-open: fetch unavailable/threw synchronously
    }
    return () => {
      cancelled = true;
    };
  }, []);
  return count;
}

export function FlashcardsNav(): React.JSX.Element {
  const t = useT();
  // Collapsed by default: the parent is always visible, but expanding the three
  // children is opt-in so the nav doesn't permanently push the PAGES tree down
  // (an always-expanded default shrinks the virtualized tree viewport).
  const [expanded, setExpanded] = useState(false);
  const dueCount = useDueCount();

  return (
    <div data-testid="flashcards-nav">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={t('sidebar.nav.flashcards.toggle')}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-8"
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" className="h-3 w-3" />
          ) : (
            <ChevronRight aria-hidden="true" className="h-3 w-3" />
          )}
        </button>
        <Link href={'/flashcards' as Route} className={ROW_CLASS} data-tour="flashcards">
          <GraduationCap aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{t('sidebar.nav.flashcards')}</span>
          {dueCount > 0 && (
            <span
              data-testid="flashcards-due-badge"
              className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground leading-none tabular-nums"
            >
              <span aria-hidden="true">{dueCount > 99 ? '99+' : dueCount}</span>
              <span className="sr-only">
                {t('sidebar.nav.flashcards.dueCount', { count: dueCount })}
              </span>
            </span>
          )}
        </Link>
      </div>
      {expanded && (
        <div>
          <Link href={'/flashcards/study' as Route} className={CHILD_CLASS}>
            {t('sidebar.nav.flashcards.due')}
          </Link>
          <Link href={'/flashcards/manage' as Route} className={CHILD_CLASS}>
            {t('flashcards.manage.nav')}
          </Link>
          <Link href={'/flashcards/orphans' as Route} className={CHILD_CLASS}>
            {t('flashcards.overview.nav.orphans')}
          </Link>
        </div>
      )}
    </div>
  );
}

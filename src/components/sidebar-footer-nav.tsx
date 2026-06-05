'use client';

import { CheckSquare, Inbox, LayoutTemplate, LogOut, Settings, Star, Trash } from 'lucide-react';
import Link from 'next/link';
import { signOutAction } from '@/lib/auth/sign-out-action';
import { useT } from '@/lib/i18n/provider';
import { ReviewDueCounter } from './sidebar/review-due-counter';
import { StudyLink } from './sidebar/study-link';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';

/**
 * Lower sidebar navigation: account-level destinations (My tasks, Templates,
 * Settings, Trash), the version footer, and a visually separated Sign out.
 *
 * Extracted from `SidebarContent` so the nav can be unit-tested without
 * rendering the async server component. Nav items use the same weight/contrast
 * as the primary "PAGES" tree items so the hierarchy reads as first-class.
 */
const NAV_ITEM_CLASS =
  'flex min-h-11 items-center gap-2 rounded px-2 py-1.5 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function SidebarFooterNav({ version }: { version: string }) {
  const t = useT();
  return (
    <div className="border-t p-3 text-sm text-muted-foreground">
      <ReviewDueCounter />
      <StudyLink />
      <Link href="/favorites" className={NAV_ITEM_CLASS}>
        <Star aria-hidden="true" className="h-4 w-4" />
        {t('sidebar.nav.favorites')}
      </Link>
      <Link href="/inbox" className={NAV_ITEM_CLASS}>
        <Inbox aria-hidden="true" className="h-4 w-4" />
        {t('sidebar.nav.inbox')}
      </Link>
      <Link href="/my-tasks" className={NAV_ITEM_CLASS}>
        <CheckSquare aria-hidden="true" className="h-4 w-4" />
        {t('sidebar.nav.myTasks')}
      </Link>
      <Link href="/templates" className={NAV_ITEM_CLASS}>
        <LayoutTemplate aria-hidden="true" className="h-4 w-4" />
        {t('sidebar.nav.templates')}
      </Link>
      <Link href="/settings" className={NAV_ITEM_CLASS}>
        <Settings aria-hidden="true" className="h-4 w-4" />
        {t('sidebar.nav.settings')}
      </Link>
      <Link href="/trash" className={NAV_ITEM_CLASS}>
        <Trash aria-hidden="true" className="h-4 w-4" />
        {t('sidebar.nav.trash')}
      </Link>
      {/* P19 #44 — full-bleed (`-mx-3`) divider + extra breathing room so the
          account/destructive Sign out group reads as a distinct boundary, not
          another same-looking nav-row gap. Sign out carries a leading LogOut
          icon and muted-foreground treatment so it reads differently from the
          `text-foreground` nav links above it. */}
      <div className="-mx-3 mt-3 flex items-center gap-2 border-t border-border px-3 pt-3">
        {/* A1 (#80) — Server Action sign-out (was a CSRF-less POST to
            /api/auth/signout that Auth.js v5 rejected → sign-out was broken). */}
        <form action={signOutAction} className="flex-1">
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 w-full justify-start gap-2 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-muted-foreground"
            type="submit"
          >
            <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
            {t('sidebar.signOut')}
          </Button>
        </form>
        <ThemeToggle />
      </div>
      <div className="mt-2 text-center text-xs text-muted-foreground">
        <a
          href={`https://github.com/jonathanmcohen/cairn/releases/tag/v${version}`}
          target="_blank"
          rel="noreferrer"
          aria-label={t('sidebar.releaseNotes', { version })}
          className="inline-flex min-h-11 items-center justify-center rounded px-2 underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          v{version}
        </a>
      </div>
    </div>
  );
}

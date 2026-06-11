'use client';

import {
  Archive,
  CheckSquare,
  HelpCircle,
  Inbox,
  LayoutTemplate,
  LogOut,
  Settings,
  Star,
  Trash,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { signOutAction } from '@/lib/auth/sign-out-action';
import { useT } from '@/lib/i18n/provider';
import { ReviewDueCounter } from './sidebar/review-due-counter';
import { StudyLink } from './sidebar/study-link';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';
import { WhatsNewPanel } from './whats-new/panel';
import { hasSeenWhatsNew, markWhatsNewSeen } from './whats-new/storage';

/**
 * Lower sidebar navigation: account-level destinations (My tasks, Templates,
 * Settings, Trash), the version footer, and a visually separated Sign out.
 *
 * Extracted from `SidebarContent` so the nav can be unit-tested without
 * rendering the async server component. Nav items use the same weight/contrast
 * as the primary "PAGES" tree items so the hierarchy reads as first-class.
 */
const NAV_ITEM_CLASS =
  'flex min-h-[28px] items-center gap-2 rounded px-2 py-1 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:py-1.5';

export function SidebarFooterNav({ version }: { version: string }) {
  const t = useT();
  // v0.10.0 E2 — What's-new panel + per-user seen-marker badge. The badge is
  // computed in an effect (not at render) so SSR/hydration markup match; it
  // shows until the localStorage marker equals the RUNNING version and is
  // cleared when the panel closes (any dismissal: X, Escape, overlay).
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [whatsNewUnseen, setWhatsNewUnseen] = useState(false);
  useEffect(() => {
    setWhatsNewUnseen(!hasSeenWhatsNew(version));
  }, [version]);
  const handleWhatsNewOpenChange = (open: boolean) => {
    setWhatsNewOpen(open);
    if (!open) {
      markWhatsNewSeen(version);
      setWhatsNewUnseen(false);
    }
  };
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
      {/* D5 — archived pages are hidden from the PAGES tree and search, so the
          only discoverable way back to them is this utility entry (next to
          Trash, its lifecycle sibling). */}
      <Link href="/archived" className={NAV_ITEM_CLASS}>
        <Archive aria-hidden="true" className="h-4 w-4" />
        {t('sidebar.nav.archived')}
      </Link>
      <Link href="/trash" className={NAV_ITEM_CLASS}>
        <Trash aria-hidden="true" className="h-4 w-4" />
        {t('sidebar.nav.trash')}
      </Link>
      {/* v0.10.0 F3 — replays the onboarding tour regardless of the seen-marker.
          The `data-tour="help"` hook doubles as the tour's own last-step anchor. */}
      <button
        type="button"
        data-tour="help"
        aria-label={t('tour.replay')}
        onClick={() => window.dispatchEvent(new CustomEvent('cairn:start-tour'))}
        className={`${NAV_ITEM_CLASS} w-full`}
      >
        <HelpCircle aria-hidden="true" className="h-4 w-4" />
        {t('tour.replay')}
      </button>
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
            className="min-h-[28px] w-full justify-start gap-2 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-muted-foreground pointer-coarse:min-h-11"
            type="submit"
          >
            <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
            {t('sidebar.signOut')}
          </Button>
        </form>
        <ThemeToggle />
      </div>
      {/* E2 — the version chip opens the in-app What's-new panel (the external
          GitHub release link moved into the panel footer, so that affordance
          isn't lost). The dot badge marks an unseen version; it is decorative
          (aria-hidden) with an sr-only i18n twin for screen readers. */}
      <div className="mt-2 text-center text-xs text-muted-foreground">
        <button
          type="button"
          data-testid="whats-new-chip"
          aria-label={t('sidebar.releaseNotes', { version })}
          onClick={() => setWhatsNewOpen(true)}
          className="relative inline-flex min-h-11 items-center justify-center rounded px-2 underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          v{version}
          {whatsNewUnseen && (
            <span data-testid="whats-new-badge" className="absolute right-0 top-2.5">
              <span aria-hidden="true" className="block h-2 w-2 rounded-full bg-primary" />
              <span className="sr-only">{t('whatsNew.badge')}</span>
            </span>
          )}
        </button>
      </div>
      <WhatsNewPanel
        version={version}
        open={whatsNewOpen}
        onOpenChange={handleWhatsNewOpenChange}
      />
    </div>
  );
}

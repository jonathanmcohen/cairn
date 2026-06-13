'use client';

import {
  Archive,
  CheckSquare,
  HelpCircle,
  Inbox,
  Keyboard,
  LogOut,
  RotateCcw,
  Settings,
  Sparkles,
  Star,
  Trash,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { signOutAction } from '@/lib/auth/sign-out-action';
import { useT } from '@/lib/i18n/provider';
import { useShortcutSheet } from './shortcuts/dispatcher';
import { NavCountPill, useNavCount } from './sidebar/nav-count-pill';
import { ReviewDueCounter } from './sidebar/review-due-counter';
import { StudyLink } from './sidebar/study-link';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { WhatsNewPanel } from './whats-new/panel';
import { hasSeenWhatsNew, markWhatsNewSeen } from './whats-new/storage';

/**
 * Lower sidebar navigation: account-level destinations (My tasks, Settings,
 * Trash), a consolidated "?" Help menu, the version footer, and a visually
 * separated Sign out.
 *
 * Extracted from `SidebarContent` so the nav can be unit-tested without
 * rendering the async server component. Nav items use the same weight/contrast
 * as the primary "PAGES" tree items so the hierarchy reads as first-class.
 */
const NAV_ITEM_CLASS =
  'flex min-h-[28px] items-center gap-2 rounded px-2 py-1 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:py-1.5';

export function SidebarFooterNav({
  version,
  favoritesCount = 0,
}: {
  version: string;
  /** v0.10.2 S9 — server-computed (SidebarContent already lists favorites). */
  favoritesCount?: number;
}) {
  const t = useT();
  // v0.10.2 S10 — the bare `?` key still opens this sheet via
  // handleShortcutKeydown; the Help menu's "Keyboard shortcuts" item is the
  // discoverable, pointer/keyboard-reachable twin of that shortcut.
  const shortcutSheet = useShortcutSheet();
  // v0.10.2 S9 — personal-hub badges. Counts are fetched client-side on mount
  // and fail OPEN (error → 0 → no pill), so a broken count endpoint can never
  // take the footer nav down with it.
  const inboxCount = useNavCount('/api/inbox/count');
  const myTasksCount = useNavCount('/api/tasks/count');
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
      {/* S9 — the star goes gold once the user has any favorite (purely
          cosmetic state echo; no theme token covers gold/amber, so raw
          yellow-500 with matching fill is the project-sanctioned choice). */}
      <Link href="/favorites" className={NAV_ITEM_CLASS}>
        <Star
          aria-hidden="true"
          data-testid="favorites-star"
          className={favoritesCount > 0 ? 'h-4 w-4 fill-yellow-500 text-yellow-500' : 'h-4 w-4'}
        />
        {t('sidebar.nav.favorites')}
      </Link>
      <Link href="/inbox" className={NAV_ITEM_CLASS}>
        <Inbox aria-hidden="true" className="h-4 w-4" />
        {t('sidebar.nav.inbox')}
        <NavCountPill
          count={inboxCount}
          label={t('sidebar.nav.inboxCount', { count: inboxCount })}
          testId="inbox-count-pill"
        />
      </Link>
      <Link href="/my-tasks" className={NAV_ITEM_CLASS}>
        <CheckSquare aria-hidden="true" className="h-4 w-4" />
        {t('sidebar.nav.myTasks')}
        <NavCountPill
          count={myTasksCount}
          label={t('sidebar.nav.myTasksCount', { count: myTasksCount })}
          testId="my-tasks-count-pill"
        />
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
      {/* v0.10.2 S10 — single "?" Help menu consolidating the help-adjacent
          actions that used to be standalone footer rows (Replay tour, What's
          new) plus the keyboard-shortcuts sheet. The `data-tour="help"` hook
          lives on the TRIGGER (it stays mounted in the sidebar regardless of
          menu open state), so it doubles as the tour's last-step anchor. The
          unseen-What's-new dot rides on the trigger so the signal survives the
          row's removal. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          data-tour="help"
          aria-label={t('sidebar.nav.help')}
          className={`${NAV_ITEM_CLASS} relative w-full`}
        >
          <HelpCircle aria-hidden="true" className="h-4 w-4" />
          {t('sidebar.nav.help')}
          {whatsNewUnseen && (
            <span
              data-testid="help-unseen-badge"
              className="absolute right-2 top-1/2 -translate-y-1/2"
            >
              <span aria-hidden="true" className="block h-2 w-2 rounded-full bg-primary" />
              <span className="sr-only">{t('whatsNew.badge')}</span>
            </span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" sideOffset={8}>
          <DropdownMenuItem
            onSelect={() => window.dispatchEvent(new CustomEvent('cairn:start-tour'))}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            {t('tour.replay')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => shortcutSheet.setOpen(true)}>
            <Keyboard aria-hidden="true" className="h-4 w-4" />
            {t('sidebar.help.shortcuts')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setWhatsNewOpen(true)}>
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            {t('sidebar.help.whatsNew')}
            {whatsNewUnseen && (
              <span className="ml-auto">
                <span aria-hidden="true" className="block h-2 w-2 rounded-full bg-primary" />
                <span className="sr-only">{t('whatsNew.badge')}</span>
              </span>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
      {/* v0.10.2 S10 — the standalone version-chip What's-new trigger was
          removed; its affordance now lives in the Help menu's "What's new"
          item above. The panel mount + open/seen state stay here. */}
      <WhatsNewPanel
        version={version}
        open={whatsNewOpen}
        onOpenChange={handleWhatsNewOpenChange}
      />
    </div>
  );
}

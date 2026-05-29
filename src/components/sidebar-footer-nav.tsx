'use client';

import { CheckSquare, LayoutTemplate, Settings, Trash } from 'lucide-react';
import Link from 'next/link';
import { ReviewDueCounter } from './sidebar/review-due-counter';
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
  'flex min-h-11 items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent';

export function SidebarFooterNav({ version }: { version: string }) {
  return (
    <div className="border-t p-3 text-sm text-muted-foreground">
      <ReviewDueCounter />
      <Link href="/my-tasks" className={NAV_ITEM_CLASS}>
        <CheckSquare aria-hidden="true" className="h-4 w-4" />
        My tasks
      </Link>
      <Link href="/templates" className={NAV_ITEM_CLASS}>
        <LayoutTemplate aria-hidden="true" className="h-4 w-4" />
        Templates
      </Link>
      <Link href="/settings" className={NAV_ITEM_CLASS}>
        <Settings aria-hidden="true" className="h-4 w-4" />
        Settings
      </Link>
      <Link href="/trash" className={NAV_ITEM_CLASS}>
        <Trash aria-hidden="true" className="h-4 w-4" />
        Trash
      </Link>
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
        <form action="/api/auth/signout" method="post" className="flex-1">
          <Button variant="ghost" size="sm" className="min-h-11 w-full justify-start" type="submit">
            Sign out
          </Button>
        </form>
        <ThemeToggle />
      </div>
      <div className="mt-2 text-center text-xs text-muted-foreground">
        <a
          href={`https://github.com/jonathanmcohen/cairn/releases/tag/v${version}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center justify-center px-2 hover:text-foreground hover:underline"
        >
          v{version}
        </a>
      </div>
    </div>
  );
}

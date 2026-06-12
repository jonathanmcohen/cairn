'use client';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { InlineIcon } from '@/components/page-icon-inline';
import { WorkspaceCreateDialog } from '@/components/workspace-create-dialog';
import type { MemberRole } from '@/lib/auth/require-role';
import { useT } from '@/lib/i18n/provider';

export type SwitcherWorkspace = {
  id: string;
  name: string;
  role: MemberRole;
  // Prefix-encoded icon ("emoji::🪨" / "file::<uuid>") or null. Rendered in the
  // trigger + row badge, falling back to the name's letter initial. (#142)
  icon: string | null;
};

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

const ITEM_CLASS =
  'flex min-h-11 w-full cursor-pointer items-center rounded-xs px-2 py-1.5 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground';

export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: SwitcherWorkspace[];
  activeId: string | null;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  async function switchTo(id: string) {
    if (id === activeId || busy) return;
    setBusy(true);
    await fetch('/api/workspaces/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: id }),
    });
    // #143 — HARD navigation (not router.push/refresh). A soft client nav keeps
    // the client-cached sidebar queries (page tree, saved searches, flashcard
    // queue, workspace meta/badge) on the OLD workspace; only a full reload
    // refetches them under the new workspace cookie (which the fetch above set).
    // #82 — land on '/' so resolveLandingPage runs (the new workspace's home),
    // not whatever route the user was on (e.g. /templates).
    window.location.assign('/');
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={t('workspaceSwitcher.switch')}
          className="flex min-h-[32px] w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-0.5 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] font-medium hover:bg-accent pointer-coarse:min-h-11 pointer-coarse:py-1.5"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[0.65rem] font-medium text-muted-foreground"
            >
              <InlineIcon value={active?.icon ?? null} fallback={initial(active?.name ?? '?')} />
            </span>
            <span className="truncate">{active?.name ?? 'No workspace'}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            // v0.10.2 P16 — track the trigger (and therefore the user-resized
            // sidebar / mobile drawer) instead of a fixed 224px; Radix sets the
            // trigger-width var on portalled Content. min-w-56 floors very
            // narrow sidebars so menu items stay readable.
            className="z-50 flex max-h-[min(24rem,70vh)] w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 flex-col rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <DropdownMenu.Label className="px-2 py-1.5 text-sm font-semibold">
              {t('workspaceSwitcher.heading')}
            </DropdownMenu.Label>
            {/* Scroll the workspace list, not the whole popover, so the Create
                item stays reachable no matter how many workspaces exist. Without
                this an account with many workspaces overflows the viewport and
                the lower items become unclickable. */}
            <div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
              {workspaces.map((w) => (
                <DropdownMenu.Item
                  key={w.id}
                  onSelect={() => void switchTo(w.id)}
                  className={ITEM_CLASS}
                >
                  <Check
                    className={`mr-1 h-4 w-4 shrink-0 ${w.id === activeId ? 'opacity-100' : 'opacity-0'}`}
                  />
                  <span
                    aria-hidden="true"
                    className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[0.65rem] font-medium text-muted-foreground"
                  >
                    <InlineIcon value={w.icon} fallback={initial(w.name)} />
                  </span>
                  <span className="truncate">{w.name}</span>
                </DropdownMenu.Item>
              ))}
            </div>
            <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-muted" />
            <DropdownMenu.Item onSelect={() => setCreateOpen(true)} className={ITEM_CLASS}>
              <Plus className="mr-2 h-4 w-4 shrink-0" />
              {t('workspaceSwitcher.create')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <WorkspaceCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

'use client';

import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { PageRowAction } from './use-page-row-actions';

const ITEM_CLASS =
  'flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xs px-2 py-1.5 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground';

/**
 * Render the canonical `PageRowAction[]` as radix menu items. Shared by the
 * hover `…` DropdownMenu (Task 2) and the right-click ContextMenu (Task 3) so
 * the two surfaces stay byte-identical. The radix `Item`/`Separator` primitives
 * differ only by namespace, so they're injected as props. The `trash` action
 * is preceded by a separator and styled destructive.
 */
export function PageActionItems({
  actions,
  Item,
  Separator,
}: {
  actions: PageRowAction[];
  Item: ComponentType<{
    onSelect?: (event: Event) => void;
    className?: string;
    children?: ReactNode;
  }>;
  Separator: ComponentType<{ className?: string }>;
}) {
  return (
    <>
      {actions.map((a) => (
        <div key={a.id}>
          {a.id === 'trash' && <Separator className="-mx-1 my-1 h-px bg-muted" />}
          <Item
            onSelect={() => void a.run()}
            className={cn(ITEM_CLASS, a.destructive && 'text-destructive focus:text-destructive')}
          >
            <a.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            {a.label}
          </Item>
        </div>
      ))}
    </>
  );
}

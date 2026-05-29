'use client';

import { ContextMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import type { FlatPageNode } from '@/lib/pages/tree';
import { PageActionItems } from './page-action-items';
import { type PageRowActionsApi, usePageRowActions } from './use-page-row-actions';

/**
 * Wrap a sidebar page row so right-click (and the keyboard ContextMenu key /
 * Shift+F10) opens an app menu carrying the SAME `usePageRowActions` set as the
 * hover `…` menu (Task 2) — single source of truth, no divergence. The row
 * passes its already-instantiated `api` (so rename state stays shared with the
 * row's inline rename); when omitted (tests) the wrapper owns the hook itself.
 * radix `ContextMenu` is keyboard-accessible: focusable trigger, arrow nav,
 * Esc to close, focus restore.
 */
export function PageRowContextMenu({
  node,
  api,
  children,
}: {
  node: FlatPageNode;
  api?: PageRowActionsApi;
  children: ReactNode;
}) {
  if (api) return <Wrapper api={api}>{children}</Wrapper>;
  return <SelfManaged node={node}>{children}</SelfManaged>;
}

function SelfManaged({ node, children }: { node: FlatPageNode; children: ReactNode }) {
  const api = usePageRowActions(node);
  return <Wrapper api={api}>{children}</Wrapper>;
}

function Wrapper({ api, children }: { api: PageRowActionsApi; children: ReactNode }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <PageActionItems
            actions={api.actions}
            Item={ContextMenu.Item}
            Separator={ContextMenu.Separator}
          />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

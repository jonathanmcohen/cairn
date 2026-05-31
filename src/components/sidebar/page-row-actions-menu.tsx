'use client';

import { MoreHorizontal, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { useT } from '@/lib/i18n/provider';
import type { FlatPageNode } from '@/lib/pages/tree';
import { MoveToPicker } from './move-to-picker';
import { PageActionItems } from './page-action-items';
import { type PageRowActionsApi, usePageRowActions } from './use-page-row-actions';

const ICON_BTN =
  'flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring outline-hidden';

/**
 * The trailing hover cluster for a sidebar page row: a `+` add-child button and
 * a `…` DropdownMenu trigger, both driven by `usePageRowActions`. The row passes
 * its already-instantiated `api` so the hook is called exactly once per row and
 * inline-rename state lives in the row; when omitted (tests) the component
 * calls the hook itself via the `SelfManaged` variant. radix gives Esc +
 * outside-click dismiss + focus restore for free.
 */
export function PageRowActionsMenu({ node, api }: { node: FlatPageNode; api?: PageRowActionsApi }) {
  if (api) return <Cluster api={api} sourceId={node.id} />;
  return <SelfManaged node={node} />;
}

/** Test/standalone path: own the hook locally. */
function SelfManaged({ node }: { node: FlatPageNode }) {
  const api = usePageRowActions(node);
  return <Cluster api={api} sourceId={node.id} />;
}

function Cluster({ api, sourceId }: { api: PageRowActionsApi; sourceId: string }) {
  const t = useT();
  const router = useRouter();
  const { actions, moveOpen, setMoveOpen } = api;
  const addChild = actions.find((a) => a.id === 'addChild');
  return (
    <div className="flex items-center">
      <button
        type="button"
        aria-label={t('pageRow.addChild')}
        className={ICON_BTN}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void addChild?.run();
        }}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={t('pageRow.actions')}
          className={ICON_BTN}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <PageActionItems
              actions={actions}
              Item={DropdownMenu.Item}
              Separator={DropdownMenu.Separator}
            />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <MoveToPicker
        open={moveOpen}
        sourceId={sourceId}
        onOpenChange={setMoveOpen}
        onMoved={() => router.refresh()}
      />
    </div>
  );
}

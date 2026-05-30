'use client';

import { Download, FileCode, FileJson, FileText } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

/**
 * Page export menu — exposes the `/api/pages/[id]/export?format=…` route as
 * direct anchor links inside a `radix-ui` DropdownMenu. The DropdownMenu brings
 * collision-aware positioning for free (`collisionPadding` + `max-w` clamp the
 * menu inside narrow viewports, #94) plus built-in focus/Escape semantics.
 *
 * PDF is browser-driven: the route returns print-ready HTML with auto-open
 * `window.print()`. Users pick "Save as PDF" from the browser dialog.
 *
 * `open`/`onOpenChange` make the menu controllable by the shared page-action
 * panels controller (single-open mutual exclusion). When omitted it
 * self-manages, so it stays usable standalone and in tests.
 */
export function PageExportMenu({
  pageId,
  open,
  onOpenChange,
}: {
  pageId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const href = (format: string) => `/api/pages/${pageId}/export?format=${format}`;
  const itemCls =
    'flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground';
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <Button variant="outline" size="sm">
          <Download aria-hidden="true" className="mr-1 h-4 w-4" />
          {t('pageActions.export.trigger')}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 min-w-[10rem] max-w-[calc(100vw-1rem)] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <DropdownMenu.Item asChild>
            <a href={href('md')} download className={itemCls}>
              <FileText aria-hidden="true" className="h-4 w-4" />
              {t('pageActions.export.markdown')}
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <a href={href('json')} download className={itemCls}>
              <FileJson aria-hidden="true" className="h-4 w-4" />
              {t('pageActions.export.json')}
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <a href={href('pdf')} target="_blank" rel="noopener noreferrer" className={itemCls}>
              <FileCode aria-hidden="true" className="h-4 w-4" />
              {t('pageActions.export.pdf')}
            </a>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

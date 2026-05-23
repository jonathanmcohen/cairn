'use client';

import { Button } from '@/components/ui/button';

/**
 * Page export menu — exposes the `/api/pages/[id]/export?format=…` route as
 * direct anchor links. Uses a native `<details>` disclosure (no `DropdownMenu`
 * primitive in this repo) so the menu is keyboard- and screen-reader-operable
 * out of the box, with no JS state of our own.
 *
 * PDF is browser-driven: the route returns print-ready HTML with auto-open
 * `window.print()`. Users pick "Save as PDF" from the browser dialog.
 */
export function PageExportMenu({ pageId }: { pageId: string }) {
  const href = (format: string) => `/api/pages/${pageId}/export?format=${format}`;
  return (
    <details className="relative inline-block">
      <summary className="list-none">
        <Button variant="outline" size="sm" asChild>
          <span className="cursor-pointer">Export</span>
        </Button>
      </summary>
      <div className="absolute right-0 z-10 mt-1 min-w-[10rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
        <a
          href={href('md')}
          download
          className="block rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        >
          Markdown (.md)
        </a>
        <a
          href={href('json')}
          download
          className="block rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        >
          JSON
        </a>
        <a
          href={href('pdf')}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        >
          PDF (via browser print)
        </a>
      </div>
    </details>
  );
}

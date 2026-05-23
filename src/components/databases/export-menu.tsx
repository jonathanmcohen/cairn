'use client';

import { Button } from '@/components/ui/button';

/**
 * Database export menu — exposes the `/api/databases/[id]/export?format=…`
 * route via direct anchor links inside a native `<details>` disclosure
 * (no shadcn DropdownMenu primitive in this repo).
 */
export function DatabaseExportMenu({ databaseId }: { databaseId: string }) {
  const href = (format: string) => `/api/databases/${databaseId}/export?format=${format}`;
  return (
    <details className="relative inline-block">
      <summary className="list-none">
        <Button variant="outline" size="sm" asChild>
          <span className="cursor-pointer">Export</span>
        </Button>
      </summary>
      <div className="absolute right-0 z-10 mt-1 min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
        <a
          href={href('csv')}
          download
          className="block rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        >
          CSV
        </a>
        <a
          href={href('json')}
          download
          className="block rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        >
          JSON
        </a>
      </div>
    </details>
  );
}

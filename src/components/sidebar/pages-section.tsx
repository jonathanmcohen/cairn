'use client';

import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import type { FlatPageNode } from '@/lib/pages/tree';
import { NewPageButton } from '../new-page-button';
import { Button } from '../ui/button';
import { type SidebarSpace, VirtualizedPageTree } from './virtualized-page-tree';

/**
 * v0.9.9 C3 (#209/#212/#213) — the PAGES region of the sidebar. Owns the
 * sticky section header (label + new-page + expand/collapse-all toggle) and
 * the flex-grown tree below it, which is the SOLE scroll container inside the
 * sidebar. The toggle drives the tree's force-collapse so every space folds
 * at once; clicking again expands all.
 */
export function PagesSection({ tree, spaces }: { tree: FlatPageNode[]; spaces?: SidebarSpace[] }) {
  const t = useT();
  const [collapseAll, setCollapseAll] = useState(false);
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div
        data-pages-header=""
        className="sticky top-0 z-10 mb-0.5 flex min-h-[28px] items-center justify-between gap-1 bg-card px-2 py-0.5 pointer-coarse:min-h-11 pointer-coarse:py-1.5"
      >
        <p
          id="sidebar-pages-heading"
          className="text-[length:var(--cairn-sidebar-heading)] uppercase tracking-wide text-foreground/60"
        >
          {t('sidebar.pages.heading')}
        </p>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-pressed={collapseAll}
            aria-label={collapseAll ? t('sidebar.pages.expandAll') : t('sidebar.pages.collapseAll')}
            onClick={() => setCollapseAll((v) => !v)}
          >
            {collapseAll ? (
              <ChevronsUpDown aria-hidden="true" className="h-4 w-4" />
            ) : (
              <ChevronsDownUp aria-hidden="true" className="h-4 w-4" />
            )}
          </Button>
          <NewPageButton />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <VirtualizedPageTree initial={tree} spaces={spaces} collapseAll={collapseAll} />
      </div>
    </section>
  );
}

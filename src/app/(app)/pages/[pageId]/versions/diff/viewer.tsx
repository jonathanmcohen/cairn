'use client';

import { type ReactElement, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { DiffBlock, InlineDiff, PMDoc, PMNode } from '@/lib/pages/version-diff';

export type VersionDiffViewerProps = {
  diff: DiffBlock[];
  snapshotA: { id: string; createdAt: Date; content: PMDoc };
  snapshotB: { id: string; createdAt: Date; content: PMDoc };
};

const COLLAPSE_THRESHOLD = 4;

type RenderRow =
  | { kind: 'block'; rowIndex: number; entry: DiffBlock }
  | { kind: 'collapsed'; firstRowIndex: number; count: number };

function groupCollapsibleRuns(diff: DiffBlock[]): RenderRow[] {
  const rows: RenderRow[] = [];
  let i = 0;
  while (i < diff.length) {
    if (diff[i]?.kind === 'unchanged') {
      let j = i;
      while (j < diff.length && diff[j]?.kind === 'unchanged') j++;
      const runLen = j - i;
      if (runLen >= COLLAPSE_THRESHOLD) {
        rows.push({ kind: 'collapsed', firstRowIndex: i, count: runLen });
      } else {
        for (let k = i; k < j; k++) {
          rows.push({ kind: 'block', rowIndex: k, entry: diff[k] as DiffBlock });
        }
      }
      i = j;
    } else {
      rows.push({ kind: 'block', rowIndex: i, entry: diff[i] as DiffBlock });
      i++;
    }
  }
  return rows;
}

function nodeText(node: PMNode): string {
  if (typeof node.text === 'string') return node.text;
  if (!node.content) return '';
  return node.content.map(nodeText).join('');
}

function renderBlock(node: PMNode) {
  // Minimal renderer — heading → <h1..6>, paragraph → <p>, fallback → <div>.
  // Snapshot rendering doesn't need full TipTap parity; the viewer is read-only.
  const text = nodeText(node);
  if (node.type === 'heading') {
    const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
    const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    return <Tag>{text}</Tag>;
  }
  return <p>{text}</p>;
}

function renderInline(tokens: InlineDiff[], side: 'left' | 'right') {
  return tokens
    .filter((t) => (side === 'left' ? t.kind !== 'add' : t.kind !== 'remove'))
    .map((t, i) => {
      const key = `${side}-${i}-${t.kind}`;
      if (t.kind === 'same') return <span key={key}>{t.text}</span>;
      if (t.kind === 'remove')
        return (
          <span key={key} className="inline-remove bg-red-100 text-red-900 dark:bg-red-900/40">
            {t.text}
          </span>
        );
      return (
        <span key={key} className="inline-add bg-green-100 text-green-900 dark:bg-green-900/40">
          {t.text}
        </span>
      );
    });
}

function DiffRow({ rowIndex, entry }: { rowIndex: number; entry: DiffBlock }) {
  if (entry.kind === 'unchanged') {
    return (
      <div data-testid={`diff-row-${rowIndex}`} className="contents">
        <div data-side="left" className="rounded border p-2 text-sm">
          {renderBlock(entry.block)}
        </div>
        <div data-side="right" className="rounded border p-2 text-sm">
          {renderBlock(entry.block)}
        </div>
      </div>
    );
  }
  if (entry.kind === 'added') {
    return (
      <div data-testid={`diff-row-${rowIndex}`} className="contents">
        <div
          data-side="left"
          className="rounded border border-dashed p-2 text-muted-foreground text-sm"
        >
          (added in B)
        </div>
        <div
          data-side="right"
          className="added rounded border border-green-300 bg-green-50 p-2 text-sm dark:border-green-900 dark:bg-green-950/30"
        >
          {renderBlock(entry.block)}
        </div>
      </div>
    );
  }
  if (entry.kind === 'removed') {
    return (
      <div data-testid={`diff-row-${rowIndex}`} className="contents">
        <div
          data-side="left"
          className="removed rounded border border-red-300 bg-red-50 p-2 text-sm dark:border-red-900 dark:bg-red-950/30"
        >
          {renderBlock(entry.block)}
        </div>
        <div
          data-side="right"
          className="rounded border border-dashed p-2 text-muted-foreground text-sm"
        >
          (removed from A)
        </div>
      </div>
    );
  }
  // changed
  return (
    <div data-testid={`diff-row-${rowIndex}`} className="contents">
      <div data-side="left" className="rounded border p-2 text-sm">
        <p>{renderInline(entry.inlineDiff, 'left')}</p>
      </div>
      <div data-side="right" className="rounded border p-2 text-sm">
        <p>{renderInline(entry.inlineDiff, 'right')}</p>
      </div>
    </div>
  );
}

export function VersionDiffViewer({ diff, snapshotA, snapshotB }: VersionDiffViewerProps) {
  const rows = useMemo(() => groupCollapsibleRuns(diff), [diff]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  return (
    <div className="grid grid-cols-2 gap-4 border-t pt-4">
      <header className="col-span-1 text-muted-foreground text-xs">
        Snapshot A · {snapshotA.createdAt.toISOString().slice(0, 19)}
      </header>
      <header className="col-span-1 text-muted-foreground text-xs">
        Snapshot B · {snapshotB.createdAt.toISOString().slice(0, 19)}
      </header>

      {rows.flatMap((row) => {
        if (row.kind === 'collapsed') {
          if (expanded.has(row.firstRowIndex)) {
            const slice = diff.slice(row.firstRowIndex, row.firstRowIndex + row.count);
            const out: ReactElement[] = [];
            for (let k = 0; k < slice.length; k++) {
              const entry = slice[k] as DiffBlock;
              const rowIndex = row.firstRowIndex + k;
              out.push(<DiffRow key={`row-${rowIndex}`} rowIndex={rowIndex} entry={entry} />);
            }
            return out;
          }
          return [
            <div key={`collapsed-${row.firstRowIndex}`} className="col-span-2 my-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    next.add(row.firstRowIndex);
                    return next;
                  })
                }
              >
                Show {row.count} identical blocks
              </Button>
            </div>,
          ];
        }
        return [<DiffRow key={`row-${row.rowIndex}`} rowIndex={row.rowIndex} entry={row.entry} />];
      })}
    </div>
  );
}

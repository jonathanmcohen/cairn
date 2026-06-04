'use client';

import { Database } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useT } from '@/lib/i18n/provider';

/** Mirror of `PreviewBlock` in `@/lib/templates/preview` — the GET route shape. */
type PreviewBlock =
  | { kind: 'page'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; text: string }
  | { kind: 'callout'; text: string }
  | { kind: 'database'; text: string };

type PreviewResponse = {
  id: string;
  name: string;
  kind: 'page' | 'database';
  blocks: PreviewBlock[];
};

export type TemplatePreviewDialogProps = {
  templateId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Read-only preview drawer (#68/#248). On `open`, fetches the sanitized block
 * summary from `GET /api/templates/[id]` (once per templateId) and renders the
 * template's actual structure — headings, paragraphs, lists, callouts, and
 * database names — as a scrollable outline. Reuses the shadcn Dialog since the
 * project has no Sheet/Drawer primitive.
 */
export function TemplatePreviewDialog({
  templateId,
  name,
  open,
  onOpenChange,
}: TemplatePreviewDialogProps) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [blocks, setBlocks] = useState<PreviewBlock[] | null>(null);
  // Guard against re-fetching the same template every time the dialog re-opens.
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (fetchedFor.current === templateId) return;
    fetchedFor.current = templateId;
    let cancelled = false;
    setLoading(true);
    setError(false);
    setBlocks(null);
    fetch(`/api/templates/${templateId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return (await res.json()) as PreviewResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setBlocks(data.blocks ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Reset the guard so a retry (re-open) can re-fetch after a failure.
        fetchedFor.current = null;
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, templateId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('templates.preview.title', { name })}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-1 overflow-y-auto text-sm">
          {loading ? (
            <p className="text-muted-foreground">{t('templates.preview.loading')}</p>
          ) : error ? (
            <p className="text-destructive">{t('templates.preview.error')}</p>
          ) : blocks && blocks.length > 0 ? (
            withKeys(blocks).map(({ key, block }) => <PreviewLine key={key} block={block} />)
          ) : (
            <p className="text-muted-foreground">{t('templates.preview.empty')}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Assign a stable React key per block. The preview list is render-once and
 * never reordered, but biome's noArrayIndexKey forbids the bare loop index, so
 * we derive a per-(kind) occurrence counter that is stable for a given payload.
 */
function withKeys(blocks: PreviewBlock[]): { key: string; block: PreviewBlock }[] {
  const seen = new Map<string, number>();
  return blocks.map((block) => {
    const n = (seen.get(block.kind) ?? 0) + 1;
    seen.set(block.kind, n);
    return { key: `${block.kind}-${n}`, block };
  });
}

function PreviewLine({ block }: { block: PreviewBlock }) {
  switch (block.kind) {
    case 'page':
      return (
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {block.text}
        </p>
      );
    case 'heading':
      return (
        <p className="font-medium" style={{ paddingLeft: `${(block.level - 1) * 0.75}rem` }}>
          {block.text}
        </p>
      );
    case 'paragraph':
      return <p className="text-muted-foreground">{block.text}</p>;
    case 'list':
      return <p className="pl-3 before:mr-2 before:content-['•']">{block.text}</p>;
    case 'callout':
      return <p className="rounded border-l-2 pl-2">{block.text}</p>;
    case 'database':
      return (
        <p className="inline-flex items-center gap-1">
          <Database aria-hidden className="size-3" />
          {block.text}
        </p>
      );
    default:
      return null;
  }
}

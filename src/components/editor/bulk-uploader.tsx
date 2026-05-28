'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useFocusTrap } from '@/lib/a11y/focus-trap';

const MAX_CONCURRENT = 4;

export type BulkKind = 'image' | 'audio' | 'video' | 'pdf' | 'file';

export type BulkResult = {
  name: string;
  kind: BulkKind;
  status: 'done' | 'failed';
  fileId?: string;
  error?: string;
  mime: string;
};

/**
 * Classify by MIME-prefix. Mirrors the server-side upload allowlist groups
 * (see `src/lib/files/upload.ts#ALLOWED_UPLOAD_MIME`). Anything that doesn't
 * match the prefixes falls through to `file` (downloadable attachment).
 */
export function classifyKind(mime: string): BulkKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  return 'file';
}

type Row = {
  file: File;
  kind: BulkKind;
  status: 'pending' | 'uploading' | 'done' | 'failed';
  fileId?: string;
  error?: string;
};

async function uploadOne(file: File): Promise<{ id: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // The /api/upload endpoint returns { file: { id, ... }, signedUrl }; we
  // only need the file id downstream — every block kind re-derives its own
  // signed URL via /api/files/<id>/signed-url at view time.
  const body = (await res.json()) as { file: { id: string } };
  return { id: body.file.id };
}

/**
 * v0.9.0 G3 P22 — Bulk upload modal.
 *
 * Owns the parallel queue + per-file status. Render a fixed-position dialog
 * (same shell pattern as `citation-add-dialog.tsx` — this repo has no
 * shared Radix Dialog primitive; the in-house shell carries focus-trap +
 * Esc-to-close + aria-labelledby). The state machine runs at most
 * `MAX_CONCURRENT = 4` uploads in flight; once every row terminates,
 * `onComplete(results)` fires once with the per-file outcome.
 *
 * Escape close is gated on in-flight count: while any row is `pending` /
 * `uploading`, requesting close is a no-op (matches the v0.6 P21 bulk
 * import/export modal contract — losing an upload mid-flight risks orphan
 * file rows).
 */
export function BulkUploader(props: {
  open: boolean;
  files: File[];
  onOpenChange: (open: boolean) => void;
  onComplete: (results: BulkResult[]) => void;
}): React.JSX.Element | null {
  const [rows, setRows] = useState<Row[]>(() =>
    props.files.map((file) => ({
      file,
      kind: classifyKind(file.type),
      status: 'pending' as const,
    })),
  );
  const calledOnComplete = useRef(false);
  const titleId = useId();
  const dialogRef = useFocusTrap<HTMLDivElement>(props.open);

  useEffect(() => {
    if (!props.open) return;
    if (calledOnComplete.current) return;

    let cancelled = false;
    const queue = [...props.files.keys()];
    let running = 0;

    const update = (i: number, patch: Partial<Row>): void => {
      setRows((prev) => {
        const next = [...prev];
        const current = next[i];
        if (!current) return prev;
        next[i] = { ...current, ...patch };
        return next;
      });
    };

    const finishIfDone = (): void => {
      setRows((prev) => {
        const allTerminal = prev.every((r) => r.status === 'done' || r.status === 'failed');
        if (allTerminal && !calledOnComplete.current) {
          calledOnComplete.current = true;
          const results: BulkResult[] = prev.map((r) => ({
            name: r.file.name,
            kind: r.kind,
            status: r.status === 'done' ? 'done' : 'failed',
            fileId: r.fileId,
            error: r.error,
            mime: r.file.type,
          }));
          props.onComplete(results);
        }
        return prev;
      });
    };

    const pump = (): void => {
      while (running < MAX_CONCURRENT && queue.length > 0) {
        const i = queue.shift();
        if (i === undefined) break;
        const file = props.files[i];
        if (!file) continue;
        running += 1;
        update(i, { status: 'uploading' });
        uploadOne(file)
          .then(({ id }) => {
            if (cancelled) return;
            update(i, { status: 'done', fileId: id });
          })
          .catch((err: unknown) => {
            if (cancelled) return;
            update(i, { status: 'failed', error: (err as Error).message });
          })
          .finally(() => {
            if (cancelled) return;
            running -= 1;
            pump();
            // Schedule a microtask check so the row update applies first
            // (the `update` setState is async; finishIfDone reads the latest
            // rows snapshot inside its own setState so it's correct either
            // way, but deferring keeps the trace easier to follow).
            queueMicrotask(finishIfDone);
          });
      }
    };

    pump();
    return () => {
      cancelled = true;
    };
  }, [props.open, props.files, props.onComplete]);

  // Esc-to-close — but refuse while any upload is still in flight.
  useEffect(() => {
    if (!props.open) return;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      const stillRunning = rows.some((r) => r.status === 'pending' || r.status === 'uploading');
      if (stillRunning) {
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      props.onOpenChange(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [props.open, props.onOpenChange, rows]);

  if (!props.open) return null;

  const doneCount = rows.filter((r) => r.status === 'done' || r.status === 'failed').length;
  const pct = rows.length === 0 ? 100 : Math.round((doneCount / rows.length) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg space-y-4 rounded-lg bg-background p-6"
      >
        <h2 id={titleId} className="font-medium text-lg">
          Uploading {rows.length} file{rows.length === 1 ? '' : 's'}
        </h2>
        <div
          aria-label={`Upload progress ${pct} percent`}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          role="progressbar"
          className="h-2 w-full overflow-hidden rounded bg-muted"
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <ul className="mt-3 space-y-1" aria-live="polite">
          {rows.map((row) => (
            <li key={row.file.name} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{row.file.name}</span>
              <span
                className={
                  row.status === 'failed'
                    ? 'text-destructive'
                    : row.status === 'done'
                      ? 'text-muted-foreground'
                      : ''
                }
              >
                {row.status}
                {row.error ? ` — ${row.error}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

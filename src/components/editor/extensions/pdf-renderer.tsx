'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnnotationKind, Rect } from '@/lib/pdf/schema';

/**
 * PDF renderer + annotation overlay (v0.9.0 G3 P17).
 *
 * On mount:
 *  1. Fetch `/api/files/[id]/signed-url` to get a short-lived signed URL.
 *  2. Fetch `/api/pdf/[id]/annotations` for the caller's saved annotations.
 *  3. Dynamic-import `pdfjs-dist`, wire its worker, then render each page to
 *     its own `<canvas>` with a transparent `<svg>` overlay on top.
 *
 * `pdfjs-dist` and its worker are heavy, so the import is lazy via the
 * surrounding extension wrapper (`pdf.tsx`) and again inside the effect so
 * SSR + unit tests can avoid loading PDF.js entirely (jsdom mocks the module
 * in the a11y / signed-URL renderer tests).
 *
 * Multi-user shared annotations are deferred to v1.0; this renderer only ever
 * reads/writes the caller's own annotations (server-side `created_by =
 * userId` filter is the source of truth).
 */

type LocalAnnotation = {
  id: string;
  pageNumber: number;
  rect: Rect;
  kind: AnnotationKind;
  content: string | null;
};

type Props = { fileId: string; defaultPage: number; pageId: string | null };

const TOOL_OPTIONS: ReadonlyArray<{ kind: AnnotationKind; label: string }> = [
  { kind: 'highlight', label: 'Highlight' },
  { kind: 'comment', label: 'Comment' },
  { kind: 'shape', label: 'Shape' },
];

export default function PdfRenderer({ fileId, defaultPage, pageId }: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [pages, setPages] = useState<number[]>([]);
  const [tool, setTool] = useState<AnnotationKind>('highlight');
  const [annotations, setAnnotations] = useState<LocalAnnotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());

  // Step 1 — fetch signed URL + saved annotations in parallel.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [urlRes, aRes] = await Promise.all([
          fetch(`/api/files/${fileId}/signed-url`),
          fetch(`/api/pdf/${fileId}/annotations`),
        ]);
        if (cancelled) return;
        if (!urlRes.ok) {
          setError(urlRes.status === 403 ? 'PDF is on an encrypted page.' : 'Cannot load PDF.');
          return;
        }
        const { url } = (await urlRes.json()) as { url: string };
        if (!cancelled) setSignedUrl(url);
        if (aRes.ok) {
          const body = (await aRes.json()) as { annotations: LocalAnnotation[] };
          if (!cancelled) setAnnotations(body.annotations);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'fetch failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  // Step 2 — once we have the URL, lazy-load pdfjs-dist and render every page.
  useEffect(() => {
    if (!signedUrl) return;
    let cancelled = false;
    void (async () => {
      try {
        const pdfjs = (await import('pdfjs-dist')) as typeof import('pdfjs-dist');
        // Resolve the worker URL via the bundler. The `?url` suffix is
        // understood by Next.js/Turbopack's asset pipeline; in unit tests the
        // module is mocked so this import never runs.
        const workerMod = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')) as {
          default: string;
        };
        pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
        const doc = await pdfjs.getDocument(signedUrl).promise;
        if (cancelled) return;
        setPages(Array.from({ length: doc.numPages }, (_, i) => i + 1));
        // Wait one paint so the canvas refs land in the map before we render.
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        for (let n = 1; n <= doc.numPages; n++) {
          if (cancelled) return;
          const page = await doc.getPage(n);
          const canvas = canvasRefs.current.get(n);
          if (!canvas) continue;
          const viewport = page.getViewport({ scale: 1.5 });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'render failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedUrl]);

  const createOnDrag = useCallback(
    async (pageNumber: number, rect: Rect) => {
      // The PdfNode wrapper reads `editor.storage.cairn.pageId` (set by the
      // host editor in `editor.tsx`) and forwards it as a prop, so this
      // client-only leaf doesn't have to walk the TipTap tree.
      if (!pageId) return;
      const res = await fetch(`/api/pdf/${fileId}/annotations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pageId,
          fileId,
          pageNumber,
          rect,
          kind: tool,
          content: null,
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { annotation: LocalAnnotation };
        setAnnotations((prev) => [...prev, body.annotation]);
      }
    },
    [fileId, pageId, tool],
  );

  if (error) {
    return (
      <div
        className="cairn-pdf-viewer my-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        role="alert"
      >
        {error}
      </div>
    );
  }

  return (
    <div className="cairn-pdf-viewer my-3 rounded-md border" data-default-page={defaultPage}>
      <div role="toolbar" aria-label="PDF annotation tools" className="flex gap-2 border-b p-2">
        {TOOL_OPTIONS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            aria-pressed={tool === kind}
            aria-label={label}
            onClick={() => setTool(kind)}
            className={
              tool === kind
                ? 'rounded bg-primary px-2 py-1 text-primary-foreground'
                : 'rounded border px-2 py-1'
            }
          >
            {label}
          </button>
        ))}
      </div>
      {pages.length === 0 && <div className="p-4 text-sm text-muted-foreground">Loading PDF…</div>}
      {pages.map((n) => (
        <div key={n} className="relative my-2" data-page={n}>
          <canvas
            aria-label={`PDF page ${n}`}
            ref={(el) => {
              if (el) canvasRefs.current.set(n, el);
              else canvasRefs.current.delete(n);
            }}
          />
          <PageOverlay
            pageNumber={n}
            annotations={annotations.filter((a) => a.pageNumber === n)}
            onCreate={(rect) => createOnDrag(n, rect)}
          />
        </div>
      ))}
    </div>
  );
}

function PageOverlay({
  pageNumber,
  annotations,
  onCreate,
}: {
  pageNumber: number;
  annotations: LocalAnnotation[];
  onCreate: (rect: Rect) => void;
}) {
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: SVG overlay needs pointer events for drag-to-annotate; toolbar buttons provide the keyboard-accessible path.
    <svg
      className="absolute inset-0 h-full w-full"
      aria-label={`Annotations on page ${pageNumber}`}
      role="img"
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        dragRef.current = {
          x: (e.clientX - rect.left) / rect.width,
          y: (e.clientY - rect.top) / rect.height,
        };
      }}
      onPointerUp={(e) => {
        if (!dragRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x2 = (e.clientX - rect.left) / rect.width;
        const y2 = (e.clientY - rect.top) / rect.height;
        const x = Math.min(dragRef.current.x, x2);
        const y = Math.min(dragRef.current.y, y2);
        const w = Math.abs(x2 - dragRef.current.x);
        const h = Math.abs(y2 - dragRef.current.y);
        dragRef.current = null;
        if (w > 0.005 && h > 0.005) onCreate({ x, y, w, h });
      }}
    >
      {annotations.map((a) => (
        <rect
          key={a.id}
          x={`${a.rect.x * 100}%`}
          y={`${a.rect.y * 100}%`}
          width={`${a.rect.w * 100}%`}
          height={`${a.rect.h * 100}%`}
          fill={a.kind === 'highlight' ? 'rgba(250,204,21,0.4)' : 'none'}
          stroke={a.kind === 'shape' ? 'currentColor' : 'none'}
          strokeWidth={2}
        />
      ))}
    </svg>
  );
}

'use client';

/**
 * v0.9.9 Plan F1 (#241) — row-detail drawer. A right-side shadcn Sheet hosting
 * a Radix Tabs surface: a Properties tab (every property reusing CellEditor +
 * a per-row rich-text body editor) and a Comments tab (the RowComments thread
 * previously reachable only from the small peek dialog). Reuses the
 * GET/PATCH /api/databases/:id/rows/:rowId contract added in F1.
 */
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RowComments } from '@/components/comments/row-comments';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { MemberRole } from '@/lib/auth/require-role';
import { propTypeLabel } from '@/lib/databases/property-labels';
import { useT } from '@/lib/i18n/provider';
import { CellEditor } from './cell-editor';
import type { DatabaseMeta } from './use-database-data';

const BODY_DEBOUNCE_MS = 600;

function BodyEditor({
  databaseId,
  rowId,
  initial,
}: {
  databaseId: string;
  rowId: string;
  initial: unknown;
}) {
  const t = useT();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(
    (doc: unknown) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void fetch(`/api/databases/${databaseId}/rows/${rowId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: doc }),
        });
      }, BODY_DEBOUNCE_MS);
    },
    [databaseId, rowId],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ undoRedo: { newGroupDelay: 250 } }),
      Placeholder.configure({ placeholder: t('databases.rowDetail.bodyPlaceholder') }),
    ],
    content: (initial as object) ?? undefined,
    immediatelyRender: false,
    onUpdate: ({ editor: ed }) => persist(ed.getJSON()),
    editorProps: {
      attributes: {
        'aria-label': t('databases.rowDetail.bodyLabel'),
        class: 'prose prose-sm max-w-none focus:outline-none',
      },
    },
  });

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">
        {t('databases.rowDetail.bodyLabel')}
      </span>
      <div className="rounded-md border px-2 py-1.5 text-sm">
        {editor ? <EditorContent editor={editor} /> : null}
      </div>
    </div>
  );
}

export function RowDetailPanel({
  databaseId,
  rowId,
  meta,
  open,
  onOpenChange,
  refresh,
  canComment,
  currentUserId,
  currentRole,
}: {
  databaseId: string;
  rowId: string;
  meta: DatabaseMeta;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refresh: () => void;
  canComment: boolean;
  currentUserId: string;
  currentRole: MemberRole;
}) {
  const t = useT();
  const [cells, setCells] = useState<Record<string, unknown>>({});
  const [body, setBody] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || !rowId) return;
    let cancelled = false;
    setLoaded(false);
    void fetch(`/api/databases/${databaseId}/rows/${rowId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { cells?: Record<string, unknown>; body?: unknown } | null) => {
        if (cancelled || !data) return;
        setCells(data.cells ?? {});
        setBody(data.body ?? null);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, rowId, databaseId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        closeLabel={t('databases.rowDetail.close')}
        className="flex w-full flex-col gap-0 sm:max-w-xl"
      >
        <SheetHeader>
          <SheetTitle>{t('databases.rowDetail.title')}</SheetTitle>
        </SheetHeader>
        <Tabs defaultValue="properties" className="flex min-h-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger value="properties">{t('databases.rowDetail.propertiesTab')}</TabsTrigger>
            <TabsTrigger value="comments">{t('databases.rowDetail.commentsTab')}</TabsTrigger>
          </TabsList>
          <TabsContent value="properties" className="min-h-0 flex-1 overflow-auto">
            <div className="space-y-3 py-2">
              {meta.properties.map((p) => (
                <div key={p.id} className="flex items-start gap-3">
                  <span className="w-32 shrink-0 pt-1 text-xs text-muted-foreground">
                    <span className="block font-medium text-foreground">{p.name}</span>
                    {propTypeLabel(p.type as never, t)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <CellEditor
                      databaseId={databaseId}
                      rowId={rowId}
                      property={p}
                      value={cells[p.id]}
                      onSaved={refresh}
                    />
                  </div>
                </div>
              ))}
              {loaded ? <BodyEditor databaseId={databaseId} rowId={rowId} initial={body} /> : null}
            </div>
          </TabsContent>
          <TabsContent value="comments" className="min-h-0 flex-1 overflow-auto">
            <RowComments
              databaseId={databaseId}
              rowId={rowId}
              canComment={canComment}
              currentUserId={currentUserId}
              currentRole={currentRole}
            />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

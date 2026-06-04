'use client';

import { Camera, History, RotateCcw, X } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { emitMutation, subscribeMutation } from '@/lib/client/mutation-bus';
import { useT } from '@/lib/i18n/provider';
import type { VersionListItem } from '@/lib/pages/versions';

type VersionHistoryProps = {
  pageId: string;
  canEdit: boolean;
  /**
   * Optional controlled open-state (used by the shared page-action-panels
   * controller for single-open mutual exclusion). When omitted the panel
   * self-manages, so it stays usable standalone and in tests.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type DiffLine = { kind: 'same' | 'add' | 'remove'; text: string };

/**
 * Longest-common-subsequence line diff. Pure, dependency-free: compares two
 * arrays of lines and emits a flat sequence of same/added/removed lines that
 * reads top-to-bottom like a unified diff. No diffs are stored or sent to the
 * server — this runs entirely client-side over the two versions' JSON.
 */
function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  // lcs[i * w + j] = length of LCS of a[i:] and b[j:]; flat Int32Array avoids
  // the `possibly undefined` index-access checks of TS strict mode.
  const lcs = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[i] === b[j]
          ? (lcs[(i + 1) * w + (j + 1)] ?? 0) + 1
          : Math.max(lcs[(i + 1) * w + j] ?? 0, lcs[i * w + (j + 1)] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const ai = a[i] as string;
    const bj = b[j] as string;
    if (ai === bj) {
      out.push({ kind: 'same', text: ai });
      i++;
      j++;
    } else if ((lcs[(i + 1) * w + j] ?? 0) >= (lcs[i * w + (j + 1)] ?? 0)) {
      out.push({ kind: 'remove', text: ai });
      i++;
    } else {
      out.push({ kind: 'add', text: bj });
      j++;
    }
  }
  while (i < n) out.push({ kind: 'remove', text: a[i++] as string });
  while (j < m) out.push({ kind: 'add', text: b[j++] as string });
  return out;
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return date.toLocaleDateString();
}

export function VersionHistory({
  pageId,
  canEdit,
  open: controlledOpen,
  onOpenChange,
}: VersionHistoryProps) {
  const t = useT();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  };
  const [versions, setVersions] = useState<VersionListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [slotA, setSlotA] = useState<string | null>(null);
  const [slotB, setSlotB] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/pages/${pageId}/versions`);
    if (!res.ok) {
      setError('Failed to load versions');
      return;
    }
    setVersions((await res.json()) as VersionListItem[]);
    setError(null);
  }, [pageId]);

  useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);

  // Re-fetch while the drawer is open whenever a snapshot mutation fires
  // anywhere (manual save below, or a future autosave emit) and whenever the
  // tab regains focus — so a left-open drawer reflects server-side autosaves.
  useEffect(() => {
    if (!open) return;
    const onFocus = () => void refetch();
    const offBus = subscribeMutation('pageVersions', onFocus);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      offBus();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [open, refetch]);

  function pick(slot: 'A' | 'B', id: string) {
    if (slot === 'A') setSlotA((cur) => (cur === id ? null : id));
    else setSlotB((cur) => (cur === id ? null : id));
  }

  function restore(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/pages/${pageId}/versions/${id}/restore`, { method: 'POST' });
      if (!res.ok) {
        toast.error('Failed to restore version');
        return;
      }
      toast.success('Restored as a new version');
      await refetch();
      emitMutation('pageVersions');
    });
  }

  // The component does NOT hold the live editor content — the route reads it
  // server-side from the persisted page row (the editor autosaves on change),
  // so a manual snapshot captures the persisted state and needs no payload.
  async function saveSnapshotNow() {
    setSaving(true);
    const res = await fetch(`/api/pages/${pageId}/versions/snapshot`, { method: 'POST' });
    setSaving(false);
    if (!res.ok) {
      toast.error(t('pageActions.versions.saveFailed'));
      return;
    }
    toast.success(t('pageActions.versions.saved'));
    await refetch();
    emitMutation('pageVersions');
  }

  const a = versions.find((v) => v.id === slotA) ?? null;
  const b = versions.find((v) => v.id === slotB) ?? null;
  const diff =
    a && b && a.id !== b.id
      ? diffLines(
          JSON.stringify(a.content, null, 2).split('\n'),
          JSON.stringify(b.content, null, 2).split('\n'),
        )
      : null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Version history"
        aria-pressed={open}
        onClick={() => setOpen(!open)}
      >
        <History aria-hidden="true" className="h-4 w-4" />
      </Button>
      {open && (
        <div className="fixed inset-y-0 right-0 z-30 shadow-lg">
          <aside className="bg-background flex h-full w-96 flex-col border-l">
            <div className="flex items-center justify-between border-b p-3">
              <h2 className="text-sm font-medium">{t('pageActions.versions.title')}</h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={t('pageActions.versions.close')}
                onClick={() => setOpen(false)}
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {canEdit && (
                <div className="mb-3 rounded-md border bg-muted/30 p-3">
                  <p className="text-muted-foreground text-xs">
                    {t('pageActions.versions.autosaveHint')}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 min-h-9"
                    disabled={saving}
                    onClick={() => void saveSnapshotNow()}
                  >
                    <Camera aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
                    {saving ? t('pageActions.versions.saving') : t('pageActions.versions.saveNow')}
                  </Button>
                </div>
              )}
              {error && <p className="text-destructive text-xs">{error}</p>}
              {versions.length === 0 && !error && (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <History aria-hidden="true" className="h-8 w-8 text-muted-foreground/60" />
                  <p className="text-sm font-medium">{t('pageActions.versions.empty.title')}</p>
                  <p className="text-muted-foreground text-xs">
                    {t('pageActions.versions.empty.body')}
                  </p>
                </div>
              )}
              <ul className="space-y-2">
                {versions.map((v) => {
                  const created = new Date(v.createdAt);
                  return (
                    <li key={v.id} className="rounded-md border p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground text-xs">
                          {relativeTime(created)}
                          {' · '}
                          {v.authorName ?? 'Unknown'}
                        </span>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            aria-label="Restore this version"
                            disabled={pending}
                            onClick={() => restore(v.id)}
                          >
                            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <Button
                          variant={slotA === v.id ? 'default' : 'outline'}
                          size="sm"
                          className="h-6 px-2 text-xs"
                          aria-pressed={slotA === v.id}
                          onClick={() => pick('A', v.id)}
                        >
                          Compare A
                        </Button>
                        <Button
                          variant={slotB === v.id ? 'default' : 'outline'}
                          size="sm"
                          className="h-6 px-2 text-xs"
                          aria-pressed={slotB === v.id}
                          onClick={() => pick('B', v.id)}
                        >
                          Compare B
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {a && b && a.id !== b.id && (
                <div className="mt-3">
                  {/* v0.9.0 G6 P32 — full side-by-side ProseMirror diff route.
                      The inline JSON diff below stays as a quick raw preview;
                      this button opens the structural block-level view. */}
                  <Link
                    href={`/pages/${pageId}/versions/diff?a=${slotA}&b=${slotB}` as Route}
                    aria-label="Open side-by-side diff"
                  >
                    <Button size="sm" variant="default" className="h-7 text-xs">
                      Compare selected
                    </Button>
                  </Link>
                </div>
              )}

              {diff && (
                <div className="mt-3">
                  <h3 className="text-muted-foreground mb-1 text-xs font-medium">Diff (A → B)</h3>
                  <pre className="overflow-x-auto rounded-md border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
                    {diff.map((line, idx) => (
                      <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional and have no stable id
                        key={idx}
                        className={
                          line.kind === 'add'
                            ? 'bg-green-500/15 text-green-700 dark:text-green-400'
                            : line.kind === 'remove'
                              ? 'bg-red-500/15 text-red-700 dark:text-red-400'
                              : 'text-muted-foreground'
                        }
                      >
                        {line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  '}
                        {line.text}
                      </div>
                    ))}
                  </pre>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

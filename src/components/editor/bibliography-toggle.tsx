'use client';

import type { Route } from 'next';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.9.7 G19 #166 — per-page bibliography visibility toggle.
 *
 * The auto-aggregated References section (P18 `<Bibliography>`) is shown by
 * default on the published `/p/[slug]` page and in the in-editor preview. This
 * control flips `pages.metadata.disable_bibliography` via a metadata-only
 * PATCH so authors can hide it. `aria-pressed` reflects the SHOWN state (the
 * inverse of `disabled`), matching the editor's other strip toggles.
 */
export function BibliographyToggle({
  pageId,
  initialDisabled,
  citationCount,
  onChange,
}: {
  pageId: string;
  initialDisabled: boolean;
  /** Live count of unique citations in the doc (finding D). */
  citationCount: number;
  onChange?: (disabled: boolean) => void;
}) {
  const t = useT();
  const [disabled, setDisabled] = useState(initialDisabled);
  const [saving, setSaving] = useState(false);
  const shown = !disabled;

  async function toggle() {
    const next = !disabled;
    setSaving(true);
    setDisabled(next);
    onChange?.(next);
    try {
      const res = await fetch(`/api/pages/${pageId}` as Route, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metadata: { disable_bibliography: next } }),
      });
      if (!res.ok) {
        // Roll back the optimistic flip on a rejected save.
        setDisabled(!next);
        onChange?.(!next);
      }
    } catch {
      setDisabled(!next);
      onChange?.(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={saving}
      aria-pressed={shown}
      title={t('editor.bibliography.toggleHint')}
      className={
        shown
          ? 'inline-flex items-center gap-1.5 rounded bg-primary px-2 py-1 text-primary-foreground text-xs disabled:opacity-60'
          : 'inline-flex items-center gap-1.5 rounded px-2 py-1 text-muted-foreground text-xs hover:bg-accent disabled:opacity-60'
      }
    >
      {t('editor.bibliography.toggle')}
      <span
        role="status"
        aria-label={t('editor.bibliography.count', { count: citationCount })}
        className={
          citationCount > 0
            ? 'inline-flex min-w-4 items-center justify-center rounded-full bg-background px-1 font-medium text-[10px] text-foreground'
            : 'inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] opacity-50'
        }
      >
        {citationCount}
      </span>
    </button>
  );
}

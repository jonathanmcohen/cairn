'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * v0.9.7 G19 #166 / v0.10.2 P1 — live "hide bibliography" state for the
 * editor.
 *
 * The visibility toggle moved from the editor toolbar into the "…" page menu
 * (PageMenu), which is rendered by the server route and cannot see this client
 * state. Mirroring the `cairn:export:open` wiring, the menu item dispatches a
 * `cairn:bibliography:toggle` window CustomEvent; this hook listens, flips the
 * state optimistically, and persists it via a metadata-only PATCH to
 * `pages.metadata.disable_bibliography` (rolling back on a rejected save).
 *
 * `canToggle` carries the old toolbar control's gating (#188 / D3): the
 * toggle was editor-only and disabled while the page was locked. The menu item
 * stays enabled (it can't know this client state), so the EVENT no-ops here
 * instead.
 */
export function useBibliographyVisibility({
  pageId,
  initialDisabled,
  canToggle,
}: {
  pageId: string;
  initialDisabled: boolean;
  canToggle: boolean;
}): boolean {
  const [disabled, setDisabled] = useState(initialDisabled);
  // Refs mirror the live values so the listener (registered once per pageId)
  // never acts on a stale closure.
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const canToggleRef = useRef(canToggle);
  canToggleRef.current = canToggle;

  useEffect(() => {
    const onToggle = () => {
      if (!canToggleRef.current) return;
      const next = !disabledRef.current;
      setDisabled(next);
      void fetch(`/api/pages/${pageId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metadata: { disable_bibliography: next } }),
      })
        .then((res) => {
          // Roll back the optimistic flip on a rejected save.
          if (!res.ok) setDisabled(!next);
        })
        .catch(() => setDisabled(!next));
    };
    window.addEventListener('cairn:bibliography:toggle', onToggle);
    return () => window.removeEventListener('cairn:bibliography:toggle', onToggle);
  }, [pageId]);

  return disabled;
}

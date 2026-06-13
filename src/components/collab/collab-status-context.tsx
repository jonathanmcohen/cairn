'use client';

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import type { CollabStatus } from '@/components/editor/use-collab-doc';

/**
 * v0.10.2 S14 — workspace-level collab-health context.
 *
 * The page-header "Live" pill lives inside the editor, but the sidebar footer
 * sits in a sibling subtree (the workspace nav), so it can't read the editor's
 * `useCollabDoc` status directly. This context bridges the two: the editor
 * publishes its current `CollabStatus` up via {@link CollabStatusReporter}, and
 * the footer reads it via {@link useCollabStatus}.
 *
 * `status` is `null` whenever no editor is mounted (no open page) — the footer
 * pill renders nothing in that state. The provider holds no status at first
 * render (SSR-safe); the reporter pushes the editor's status from an effect.
 *
 * Fail-safe: if no provider is mounted (e.g. a unit test rendering the footer in
 * isolation, or a route outside the authed app shell), {@link useCollabStatus}
 * returns the `{ status: null }` sentinel and never throws — mirroring the
 * `useConfirm` no-provider contract.
 */

type CollabStatusContextValue = {
  status: CollabStatus | null;
  setStatus: (status: CollabStatus | null) => void;
};

const SENTINEL: CollabStatusContextValue = {
  status: null,
  // No provider mounted: publishing is a no-op rather than a throw.
  setStatus: () => {},
};

const CollabStatusContext = createContext<CollabStatusContextValue | null>(null);

export function CollabStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CollabStatus | null>(null);
  const value = useMemo<CollabStatusContextValue>(() => ({ status, setStatus }), [status]);
  return <CollabStatusContext.Provider value={value}>{children}</CollabStatusContext.Provider>;
}

/**
 * Reader hook for the current workspace-level collab status. Returns
 * `{ status: null }` when no editor is open OR when no provider is mounted.
 */
export function useCollabStatus(): { status: CollabStatus | null } {
  const ctx = useContext(CollabStatusContext) ?? SENTINEL;
  return { status: ctx.status };
}

/**
 * Effect-only component the editor mounts to publish its live collab status up
 * to the provider. Republishes on every status change; on unmount it publishes
 * `null` so the footer pill disappears once the page/editor is gone. Renders
 * nothing.
 */
export function CollabStatusReporter({ status }: { status: CollabStatus }) {
  const ctx = useContext(CollabStatusContext);
  const setStatus = ctx?.setStatus;
  useEffect(() => {
    if (!setStatus) return;
    setStatus(status);
    return () => setStatus(null);
  }, [status, setStatus]);
  return null;
}

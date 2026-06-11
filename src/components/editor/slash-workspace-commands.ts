/**
 * v0.10.0 F2 — client-side source for the slash menu's "Workspace" group.
 *
 * The @tiptap/suggestion `items()` callback is synchronous-per-keystroke, so
 * the workspace's custom commands are fetched ONCE per editor mount
 * (`primeWorkspaceSlashCommands`, called from editor.tsx) into a module-level
 * cache keyed by workspace id; `items()` then reads the cache synchronously
 * via `getWorkspaceSlashCommands`.
 *
 * Staleness (documented v1 contract): the menu reflects the commands as of
 * the LAST editor mount — commands added/removed in workspace settings appear
 * after the next page open/reload. Each mount's prime overwrites the cache,
 * so it never drifts further than one mount. Template payloads are immutable
 * snapshots, so cached `content` can't go stale by edit; template DELETION
 * cascades the command row away server-side and the next mount's fetch drops
 * it from the menu.
 */

/** One workspace command as served by GET /api/workspaces/[id]/slash-commands. */
export type WorkspaceSlashCommandItem = {
  id: string;
  trigger: string;
  label: string;
  templateId: string;
  templateName: string;
  enabled: boolean;
  /** Root-page ProseMirror node array, resolved server-side; null = nothing
   *  insertable (malformed/empty payload) — such commands are hidden. */
  content: unknown[] | null;
};

const cache = new Map<string, WorkspaceSlashCommandItem[]>();

/**
 * Pure filter shared by the cache write and the unit tests: only enabled
 * commands with non-empty insertable content reach the menu.
 */
export function insertableWorkspaceSlashCommands(
  rows: WorkspaceSlashCommandItem[],
): WorkspaceSlashCommandItem[] {
  return rows.filter((r) => r.enabled && Array.isArray(r.content) && r.content.length > 0);
}

/** Synchronous cache read for the slash `items()` callback. */
export function getWorkspaceSlashCommands(
  workspaceId: string | undefined,
): WorkspaceSlashCommandItem[] {
  if (!workspaceId) return [];
  return cache.get(workspaceId) ?? [];
}

/** Test seam + settings-page invalidation hook. */
export function setWorkspaceSlashCommandsCache(
  workspaceId: string,
  rows: WorkspaceSlashCommandItem[],
): void {
  cache.set(workspaceId, insertableWorkspaceSlashCommands(rows));
}

export function clearWorkspaceSlashCommandsCache(workspaceId?: string): void {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}

/**
 * Fetch the workspace's commands into the cache. Failure-tolerant: on any
 * error the cache keeps its previous value and the menu simply shows the
 * built-ins — custom commands are sugar, never worth breaking the editor.
 */
export async function primeWorkspaceSlashCommands(workspaceId: string): Promise<void> {
  try {
    const res = await fetch(`/api/workspaces/${workspaceId}/slash-commands`);
    if (!res.ok) return;
    const body = (await res.json()) as { commands?: WorkspaceSlashCommandItem[] };
    setWorkspaceSlashCommandsCache(workspaceId, body.commands ?? []);
  } catch {
    // network hiccup — built-ins only until the next mount.
  }
}

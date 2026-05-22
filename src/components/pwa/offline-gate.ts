/**
 * Bounded-offline gate (PURE — no React, no `navigator`, fully unit-testable).
 *
 * The contract: while offline, the ONLY allowed action is a `yjs-edit` on a doc
 * that is already loaded (Yjs edits are conflict-free and replay on reconnect via
 * y-indexeddb). Every other action — create/move/delete/restore, db mutations,
 * uploads, comments, sharing, admin — touches the server and is disabled offline.
 * While online, everything is allowed.
 */

export type ActionKind =
  | 'yjs-edit'
  | 'page-create'
  | 'page-move'
  | 'page-delete'
  | 'page-restore'
  | 'db-row-mutate'
  | 'file-upload'
  | 'comment'
  | 'share'
  | 'admin';

export type OfflineState = { online: boolean };

export function isActionAllowedOffline(action: ActionKind, state: OfflineState): boolean {
  if (state.online) return true;
  return action === 'yjs-edit';
}

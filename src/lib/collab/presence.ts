export interface PresenceUser {
  id: string;
  name: string;
  color: string;
  image?: string | null;
}

/** Raw awareness `user` payload as written by CollaborationCaret + our config. */
interface AwarenessUser {
  id?: unknown;
  name?: unknown;
  color?: unknown;
  image?: unknown;
}

/**
 * Reduce a Yjs awareness states map (clientId → state) into a deduped,
 * id-sorted list of *remote* users (excluding `localClientId`).
 * Multiple clients for the same user id collapse to one entry. Pure.
 */
export function awarenessToUsers(
  states: Map<number, { user?: AwarenessUser | null }>,
  localClientId: number,
): PresenceUser[] {
  const byId = new Map<string, PresenceUser>();
  for (const [clientId, state] of states) {
    if (clientId === localClientId) continue;
    const u = state?.user;
    if (!u || typeof u.id !== 'string' || u.id.length === 0) continue;
    if (byId.has(u.id)) continue;
    byId.set(u.id, {
      id: u.id,
      name: typeof u.name === 'string' ? u.name : 'Anonymous',
      color: typeof u.color === 'string' ? u.color : 'hsl(0, 0%, 50%)',
      image: typeof u.image === 'string' ? u.image : null,
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

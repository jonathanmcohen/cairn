'use client';

import type { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useState } from 'react';
import { awarenessToUsers, type PresenceUser } from '@/lib/collab/presence';

/**
 * Live list of remote collaborators from the provider's Yjs awareness.
 * Re-renders on every awareness `change`. Returns [] when not yet connected.
 */
export function useCollabPresence(provider: HocuspocusProvider | null): PresenceUser[] {
  const [users, setUsers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    if (!provider) {
      setUsers([]);
      return;
    }
    const awareness = provider.awareness;
    if (!awareness) return;

    const update = () => {
      setUsers(awarenessToUsers(awareness.getStates(), awareness.clientID));
    };
    update(); // seed initial
    awareness.on('change', update);
    return () => {
      awareness.off('change', update);
    };
  }, [provider]);

  return users;
}

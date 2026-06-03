'use client';

/**
 * Tiny dependency-free pub/sub for client-side mutation notifications.
 *
 * Cairn relies on App Router `router.refresh()` for server-data freshness,
 * but that only re-renders server components — sibling *client* components
 * (e.g. the saved-search sidebar vs. the ⌘K palette that creates one) hold
 * their own fetched state and never hear about each other's mutations. This
 * bus is the standardized signal: a mutating component calls
 * `emitMutation(topic)`, every component reading that topic re-fetches.
 *
 * Backed by a single module-level EventTarget so there is exactly one bus
 * per browser tab. SSR-safe: EventTarget exists in the Node/edge runtime, and
 * all callers are 'use client'.
 */
export type MutationTopic = 'savedSearches' | 'pageVersions';

const bus = new EventTarget();

export function emitMutation(topic: MutationTopic): void {
  bus.dispatchEvent(new Event(topic));
}

export function subscribeMutation(topic: MutationTopic, cb: () => void): () => void {
  bus.addEventListener(topic, cb);
  return () => bus.removeEventListener(topic, cb);
}

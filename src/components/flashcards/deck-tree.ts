/**
 * Shared deck-tree helpers (v0.10.2 F2 Task C). Decks are stored flat with a
 * `parentDeckId`; the UI assembles the nested tree client-side (deck counts are
 * small, so no virtualization is needed — see the task brief). These pure
 * helpers are used by both the decks-client tree and the `<DeckTreePicker>`
 * shared by the manage bulk-move and the move/merge target selectors.
 */

/** Minimal shape the tree helpers need from a deck row. */
export type DeckTreeNode = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  parentDeckId: string | null;
};

/** A deck flattened in depth-first order with its tree depth attached. */
export type FlatDeck<T extends DeckTreeNode> = { deck: T; depth: number };

/**
 * Flatten decks into depth-first order, carrying each node's depth so callers
 * can indent. Siblings are ordered by name (case-insensitive). Decks whose
 * `parentDeckId` points at a missing/foreign deck are treated as roots so they
 * never vanish from the list. A cycle guard caps recursion via a visited set.
 */
export function flattenDeckTree<T extends DeckTreeNode>(decks: T[]): Array<FlatDeck<T>> {
  const byParent = new Map<string | null, T[]>();
  const ids = new Set(decks.map((d) => d.id));
  for (const d of decks) {
    // Re-root orphans (parent not in this set) so they still render.
    const parent = d.parentDeckId && ids.has(d.parentDeckId) ? d.parentDeckId : null;
    const bucket = byParent.get(parent);
    if (bucket) bucket.push(d);
    else byParent.set(parent, [d]);
  }
  for (const bucket of byParent.values()) {
    bucket.sort((a, b) => a.name.localeCompare(b.name));
  }

  const out: Array<FlatDeck<T>> = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number): void => {
    for (const deck of byParent.get(parentId) ?? []) {
      if (visited.has(deck.id)) continue;
      visited.add(deck.id);
      out.push({ deck, depth });
      walk(deck.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * The set of deck ids that are `deckId` itself or a descendant of it. Used to
 * disable invalid drop/merge/move targets in the client (the server has its own
 * cycle guard, but disabling the option avoids a guaranteed-409 round trip).
 */
export function descendantIds<T extends DeckTreeNode>(decks: T[], deckId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const d of decks) {
    if (d.parentDeckId) {
      const bucket = children.get(d.parentDeckId);
      if (bucket) bucket.push(d.id);
      else children.set(d.parentDeckId, [d.id]);
    }
  }
  const out = new Set<string>([deckId]);
  const stack = [deckId];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) break;
    for (const child of children.get(cur) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        stack.push(child);
      }
    }
  }
  return out;
}

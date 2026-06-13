import { describe, expect, it } from 'vitest';
import {
  type DeckTreeNode,
  descendantIds,
  flattenDeckTree,
} from '../../../src/components/flashcards/deck-tree';

function deck(id: string, name: string, parentDeckId: string | null = null): DeckTreeNode {
  return { id, name, icon: null, color: null, parentDeckId };
}

describe('flattenDeckTree', () => {
  it('orders roots by name (case-insensitive) at depth 0', () => {
    const flat = flattenDeckTree([deck('b', 'Beta'), deck('a', 'alpha'), deck('c', 'Charlie')]);
    expect(flat.map((f) => f.deck.id)).toEqual(['a', 'b', 'c']);
    expect(flat.every((f) => f.depth === 0)).toBe(true);
  });

  it('nests children depth-first under their parent, siblings sorted by name', () => {
    const flat = flattenDeckTree([
      deck('root', 'Root'),
      deck('child-z', 'Zeta', 'root'),
      deck('child-a', 'Apple', 'root'),
      deck('grandchild', 'Grand', 'child-a'),
    ]);
    expect(flat.map((f) => [f.deck.id, f.depth])).toEqual([
      ['root', 0],
      ['child-a', 1],
      ['grandchild', 2],
      ['child-z', 1],
    ]);
  });

  it('re-roots a deck whose parent is missing so it never vanishes', () => {
    const flat = flattenDeckTree([deck('orphan', 'Orphan', 'gone')]);
    expect(flat.map((f) => [f.deck.id, f.depth])).toEqual([['orphan', 0]]);
  });

  it('does not infinite-loop on a cyclic parent chain', () => {
    // a -> b -> a (data corruption); the visited guard caps recursion.
    const flat = flattenDeckTree([deck('a', 'A', 'b'), deck('b', 'B', 'a')]);
    // Neither node is reachable from the null root (both have a parent), so the
    // walk terminates without emitting them rather than looping forever.
    expect(flat.length).toBeLessThanOrEqual(2);
  });
});

describe('descendantIds', () => {
  it('includes the deck itself and all transitive descendants', () => {
    const decks = [
      deck('root', 'Root'),
      deck('a', 'A', 'root'),
      deck('b', 'B', 'a'),
      deck('c', 'C', 'root'),
      deck('other', 'Other'),
    ];
    expect([...descendantIds(decks, 'root')].sort()).toEqual(['a', 'b', 'c', 'root']);
    expect([...descendantIds(decks, 'a')].sort()).toEqual(['a', 'b']);
    expect([...descendantIds(decks, 'other')]).toEqual(['other']);
  });
});

'use client';

import { InlineIcon } from '@/components/page-icon-inline';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type DeckTreeNode, flattenDeckTree } from './deck-tree';

/**
 * Shared deck **tree** picker (v0.10.2 F2 Task C) — a `<Select>` whose options
 * are the workspace decks flattened depth-first and indented by tree depth, so
 * nested decks are choosable. Used by:
 *   - the manage bulk action bar's "Move to deck" (was a flat select), and
 *   - the decks-client "Move all cards to…" / "Merge into…" target selectors.
 *
 * `disabledIds` greys out targets the caller must forbid (e.g. a deck and its
 * own descendants, to avoid a guaranteed-409 reparent/merge round trip). The
 * server still enforces the cycle guard; this is a UX nicety, not the gate.
 */
export function DeckTreePicker({
  decks,
  value,
  onValueChange,
  placeholder,
  disabledIds,
  extraOptions,
  triggerClassName,
  triggerTestId,
}: {
  decks: DeckTreeNode[];
  value: string | undefined;
  onValueChange: (deckId: string) => void;
  placeholder?: string;
  disabledIds?: Set<string>;
  /** Non-deck sentinel options appended after the tree (e.g. "No deck"). */
  extraOptions?: Array<{ value: string; label: string }>;
  triggerClassName?: string;
  triggerTestId?: string;
}) {
  const flat = flattenDeckTree(decks);
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={triggerClassName} data-testid={triggerTestId}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {flat.map(({ deck, depth }) => (
          <SelectItem
            key={deck.id}
            value={deck.id}
            disabled={disabledIds?.has(deck.id)}
            data-testid="deck-tree-option"
          >
            <span
              className="flex items-center gap-1.5"
              style={{ paddingInlineStart: `${depth * 14}px` }}
            >
              <InlineIcon value={deck.icon} fallback={null} />
              <span>{deck.name}</span>
            </span>
          </SelectItem>
        ))}
        {extraOptions?.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

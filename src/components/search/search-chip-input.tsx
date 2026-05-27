'use client';

import { ChevronDown, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OPERATOR_KEYS, type ParseResult, parseQuery } from '@/lib/search/operators';

export type SearchChipInputProps = {
  initialValue: string;
  onChange: (result: ParseResult & { raw: string }) => void;
};

function needsQuotes(v: string): boolean {
  return /\s/.test(v);
}

/**
 * Chip-builder input. Internally stores the raw string and reparses on every
 * change. Chips are rendered for each parsed operator; the free-text segment
 * is shown in the trailing input. `key:value<space>` (and Enter) is the
 * collapse trigger — the chip appears once `parseQuery` reports the token as
 * a known op.
 *
 * The "Add filter" trigger expands a simple HTML menu (`role="menu"`) of the
 * known operator keys; selecting one appends `<key>:` to the raw string so
 * the user can immediately type a value. No external popover dependency.
 */
export function SearchChipInput({ initialValue, onChange }: SearchChipInputProps) {
  const [raw, setRaw] = useState(initialValue);
  const [menuOpen, setMenuOpen] = useState(false);
  const parsed = useMemo(() => parseQuery(raw), [raw]);

  useEffect(() => {
    onChange({ ...parsed, raw });
  }, [parsed, raw, onChange]);

  const removeOp = useCallback(
    (idx: number) => {
      const ops = parsed.ops.filter((_, i) => i !== idx);
      const opsText = ops
        .map((o) => `${o.key}:${needsQuotes(o.value) ? `"${o.value}"` : o.value}`)
        .join(' ');
      setRaw([opsText, parsed.free].filter(Boolean).join(' '));
    },
    [parsed],
  );

  const addEmptyChip = useCallback((key: string) => {
    setRaw((prev) => `${prev}${prev.endsWith(' ') || prev === '' ? '' : ' '}${key}:`);
    setMenuOpen(false);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border px-2 py-1.5">
      {parsed.ops.map((op, idx) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: chip identity is
          // stable for its render position; ops may carry duplicate
          // key:value pairs (e.g. type:page type:db_row) so a composite key
          // is not unique.
          key={`${op.key}-${op.value}-${idx}`}
          className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
        >
          <span>
            {op.key}:{op.value}
          </span>
          <button
            type="button"
            aria-label={`remove ${op.key}:${op.value}`}
            onClick={() => removeOp(idx)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <Input
        aria-label="Search"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!raw.endsWith(' ')) setRaw(`${raw} `);
          }
        }}
        className="flex-1 border-none bg-transparent px-1 focus-visible:ring-0"
      />
      <div className="relative">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Add filter"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          Add filter
          <ChevronDown className="ml-1 size-3" />
        </Button>
        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 z-10 mt-1 min-w-32 rounded-md border bg-popover py-1 shadow-md"
          >
            {OPERATOR_KEYS.map((key) => (
              <button
                type="button"
                role="menuitem"
                key={key}
                onClick={() => addEmptyChip(key)}
                className="block w-full px-3 py-1 text-left text-sm hover:bg-accent"
              >
                {key}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {parsed.warnings.map((w) =>
        w.kind === 'unknown_key' ? (
          <span key={w.token} className="ml-2 text-xs text-destructive">
            Unknown filter: {w.token.split(':')[0]}
          </span>
        ) : null,
      )}
    </div>
  );
}

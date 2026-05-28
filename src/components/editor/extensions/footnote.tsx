'use client';

import { useId, useState } from 'react';
import { FootnoteMark } from '@/components/editor/blocks/footnote-mark';

// React side is a thin client component: the editor renders <sup>s via the mark
// itself; the public page renderer + reader-mode renderer use the JSX below to
// turn each <sup data-footnote-id> into a click-to-reveal note. Numbering is
// done by numberFootnotes() in `src/lib/citations/numbering.ts` at render time.

export { FootnoteMark };

/**
 * Render a numbered superscript anchor that toggles an inline popover with the
 * footnote text. Implemented without shadcn's Popover (not installed in this
 * repo) — a plain controlled `<details>`-style toggle keeps the dependency
 * surface small while satisfying the WAI-ARIA `doc-noteref` + `aria-describedby`
 * pairing required for screen-reader users.
 *
 * Biome a11y note: the WAI-ARIA `doc-noteref` role belongs on the focusable
 * trigger (the `<button>`), not the wrapping `<sup>` — Biome v2 rejects
 * interactive roles on non-focusable elements, and `<sup>` itself isn't
 * tab-focusable in any browser.
 */
export function FootnoteSup({
  number,
  content,
}: {
  number: number;
  content: string;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  return (
    <span className="relative inline">
      <sup className="text-primary">
        <button
          type="button"
          role="doc-noteref"
          aria-describedby={noteId}
          aria-expanded={open}
          aria-label={`Footnote ${number}`}
          onClick={() => setOpen((v) => !v)}
          className="cursor-pointer bg-transparent p-0 text-inherit underline"
        >
          [{number}]
        </button>
      </sup>
      {open && (
        <span
          id={noteId}
          role="doc-footnote"
          className="absolute left-0 top-full z-10 mt-1 max-w-sm rounded-md border bg-popover p-2 text-sm shadow-md"
        >
          {content}
        </span>
      )}
    </span>
  );
}

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
 */
export function FootnoteSup({ number, content }: { number: number; content: string }): React.ReactNode {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  return (
    <span className="relative inline">
      <sup
        role="doc-noteref"
        aria-describedby={noteId}
        aria-expanded={open}
        aria-label={`Footnote ${number}`}
        className="cursor-pointer text-primary underline"
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="bg-transparent p-0 text-inherit"
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

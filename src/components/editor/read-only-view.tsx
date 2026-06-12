'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CitationStyle } from '@/lib/citations/format';
import { numberFootnotes } from '@/lib/citations/numbering';
import { baseExtensions } from './extensions';
import { FootnoteSup } from './extensions/footnote';
import { ReadOnlyMentionExtension } from './mention-readonly-extension';
import { PublicDatabaseNode } from './public-database-extension';

function publicExtensions(citationStyle: CitationStyle) {
  // Swap the editor's `database` node for the public read-only one, and the
  // interactive `mention` node (link + suggestion) for the inert read-only
  // span variant so stored `@[Name](userId)` tokens still render as `@Name`.
  //
  // The page-link nodes (pageLink/pageMention/pageEmbed) are schema-pure with a
  // static renderHTML, so they flow through from baseExtensions() unchanged and
  // render the stored snapshot on `/p/` + `/s/`. Only their interactive picker
  // plugin (`pageLinkSuggestion`) is dropped from the read-only path.
  //
  // v0.10.2 P5 — the citation node-view (superscript `[n]` chip + attrs-only
  // hover popover) rides along from baseExtensions(); it's editable-gated
  // internally so the read-only surface never shows the Add-citation
  // affordance. `citationStyle` picks the formatted line shown in the popover
  // (same style the <Bibliography> below the body uses).
  return [
    ...baseExtensions({ citationStyle }).filter(
      (e) => e.name !== 'database' && e.name !== 'mention' && e.name !== 'pageLinkSuggestion',
    ),
    PublicDatabaseNode,
    ReadOnlyMentionExtension,
  ];
}

export function ReadOnlyView({
  content,
  citationStyle = 'apa',
}: {
  content: unknown;
  citationStyle?: CitationStyle;
}) {
  const editor = useEditor({
    extensions: publicExtensions(citationStyle),
    content: content as never,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose dark:prose-invert max-w-none focus:outline-hidden',
      },
    },
  });

  // v0.9.0 G3 P18 — footnote hydration. The FootnoteMark's renderHTML emits a
  // bare `<sup data-footnote-id data-footnote-content>` with no number and no
  // popover. After the editor mounts we walk its DOM, compute the document-
  // order number map via `numberFootnotes`, blank out each <sup>'s text content
  // and mount a `<FootnoteSup number text>` portal into it so the public page
  // shows the numbered superscript + click-to-reveal popover.
  const footnoteMap = useMemo(
    () =>
      numberFootnotes(
        (content ?? { type: 'doc', content: [] }) as Parameters<typeof numberFootnotes>[0],
      ),
    [content],
  );
  const [mounts, setMounts] = useState<
    Array<{ host: HTMLElement; id: string; number: number; text: string }>
  >([]);

  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom as HTMLElement;
    const collect = () => {
      const sups = Array.from(root.querySelectorAll<HTMLElement>('sup[data-footnote-id]'));
      const next: Array<{ host: HTMLElement; id: string; number: number; text: string }> = [];
      for (const sup of sups) {
        const id = sup.getAttribute('data-footnote-id') ?? '';
        const number = footnoteMap.map[id];
        if (!id || number === undefined) continue;
        const text =
          sup.getAttribute('data-footnote-content') ??
          footnoteMap.ordered.find((e) => e.id === id)?.content ??
          '';
        // Hide the bare TipTap-emitted <sup> and mount the interactive
        // FootnoteSup (its own <sup> + popover) into a sibling <span>. Nesting
        // <sup> inside <sup> would be valid phrasing content but visually
        // doubles the superscript shift; sibling-mount keeps a single shift.
        sup.style.display = 'none';
        let mount = sup.nextElementSibling as HTMLElement | null;
        if (!mount || mount.dataset.footnoteMount !== id) {
          mount = document.createElement('span');
          mount.dataset.footnoteMount = id;
          sup.after(mount);
        }
        next.push({ host: mount, id, number, text });
      }
      setMounts(next);
    };
    collect();
    editor.on('update', collect);
    return () => {
      editor.off('update', collect);
    };
  }, [editor, footnoteMap]);

  return (
    <div className="relative">
      <EditorContent editor={editor} />
      {mounts.map((m) =>
        createPortal(
          <FootnoteSup number={m.number} content={m.text} />,
          m.host,
          `${m.id}-${m.number}`,
        ),
      )}
    </div>
  );
}

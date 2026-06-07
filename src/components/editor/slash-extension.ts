import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import {
  Asterisk,
  BookMarked,
  Bookmark,
  CalendarClock,
  ChevronRight,
  Code,
  Code2,
  Columns2,
  Database,
  FileSymlink,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Images,
  Info,
  Layers,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Minus,
  MousePointerClick,
  Music,
  Network,
  Paperclip,
  PenTool,
  Quote,
  RefreshCw,
  Sigma,
  Table,
  Video,
  Workflow,
} from 'lucide-react';
import tippy, { type Instance, type Props as TippyProps } from 'tippy.js';
import { FootnoteMark } from './blocks/footnote-mark';
import {
  asFormResult,
  type EditorDialogCitationResult,
  type EditorDialogEquationResult,
  openEditorDialog,
} from './editor-dialog-bus';
import { type LazyEditorNodeName, loadEditorExtension } from './extensions-lazy';
import { type PageItem, PageLinkList, type PageLinkListRef } from './page-link-list';
import { fetchPages } from './page-link-suggestion';
import {
  type SlashCategory,
  type SlashItem,
  SlashMenu,
  type SlashMenuRef,
  type SlashRange,
} from './slash-menu';

/**
 * Ensure a lazy editor extension (math/syncedBlock/embed) is registered on
 * the editor instance before issuing its `setXxx` command. The slash menu
 * delete-range-then-call sequence (`SlashCommand.suggestion.command`) means by
 * the time `then` fires the caret is at the right spot for insertion. We use
 * `extensionManager.extensions.some(...)` to make the merge idempotent —
 * TipTap dedupes by name internally too, but the early-return keeps the
 * happy path allocation-free after the first load.
 */
function ensureLazyExtension(editor: Editor, name: LazyEditorNodeName): Promise<void> {
  return loadEditorExtension(name).then((ext) => {
    if (editor.isDestroyed) return;
    if (!editor.extensionManager.extensions.some((e) => e.name === ext.name)) {
      editor.setOptions({ extensions: [...editor.extensionManager.extensions, ext] });
    }
  });
}

/**
 * Open a transient page-picker popup at the current selection, reusing the
 * `[[`/`@@` autocomplete's `fetchPages` + `PageLinkList`. Calls `onPick` with the
 * chosen page, then tears the popup down. Used by the "Page embed" slash item.
 */
function openPagePicker(editor: Editor, onPick: (item: PageItem) => void): void {
  let component: ReactRenderer<
    PageLinkListRef,
    { items: PageItem[]; command: (i: PageItem) => void }
  >;
  let popup: Instance<TippyProps>;

  const close = () => {
    document.removeEventListener('keydown', onKeyDown, true);
    popup?.destroy();
    component?.destroy();
  };
  const choose = (item: PageItem) => {
    onPick(item);
    close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (component?.ref?.onKeyDown(event)) event.preventDefault();
  };

  const rect = () => {
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
  };

  component = new ReactRenderer(PageLinkList, {
    props: { items: [], command: choose },
    editor,
  });
  popup = tippy(document.body, {
    getReferenceClientRect: rect,
    appendTo: () => document.body,
    content: component.element,
    showOnCreate: true,
    interactive: true,
    trigger: 'manual',
    placement: 'bottom-start',
  });
  document.addEventListener('keydown', onKeyDown, true);

  void fetchPages('').then((items) => {
    component.updateProps({ items, command: choose });
  });
}

/**
 * Slash-menu entry for the PDF block (v0.9.0 G3 P17). Opens a file picker
 * restricted to `application/pdf`, uploads via `/api/upload`, then inserts a
 * `pdf` node carrying the new `fileId`. Exported so the editor's drop handler
 * (in `editor.tsx`) can share the same insertion code-path, and so a unit
 * test can verify the entry without spinning up the full slash extension.
 */
/**
 * v0.9.0 G3 P18 — Footnote + Citation slash entries.
 *
 * Exported in the `{ command, title, description, run }` shape that the plan's
 * test fixture (`tests/components/editor/citation-slash.test.ts`) probes.
 * The active slash menu still consumes the `SlashItem` shape (`{ title,
 * description, command(editor) }`) — see the `items` array below where these
 * two get appended via `toSlashItem()`.
 */
export type CitationSlashEntry = {
  command: `/${string}`;
  title: string;
  description: string;
  // #38 — accepts the slash trigger range so it can delete the `/query` text
  // ONLY once the dialog resolves to a real insert (restore-on-cancel).
  run: (editor: Editor, range?: SlashRange) => void;
  icon?: SlashItem['icon'];
  keywords?: string[];
};

export const footnoteMenuItem: CitationSlashEntry = {
  command: '/footnote',
  title: 'Footnote',
  description: 'Add an inline footnote',
  icon: Asterisk,
  keywords: ['note', 'fn'],
  run: (editor: Editor, range?: SlashRange): void => {
    consumeSlashRange(editor, range);
    void openEditorDialog({ kind: 'footnote', title: 'Footnote' }).then((raw) => {
      const result = asFormResult(raw);
      const content = result?.text;
      if (!content) return;
      if (editor.isDestroyed) return;
      if (!editor.extensionManager.extensions.some((e) => e.name === FootnoteMark.name)) {
        editor.setOptions({ extensions: [...editor.extensionManager.extensions, FootnoteMark] });
      }
      const id = crypto.randomUUID();
      editor.chain().focus().setMark('footnote', { id, content }).run();
    });
  },
};

export const citationMenuItem: CitationSlashEntry = {
  command: '/citation',
  title: 'Citation',
  description: 'Insert a bibliographic reference',
  icon: Quote,
  keywords: ['cite', 'ref', 'reference', 'bibliography'],
  run: (editor: Editor, range?: SlashRange): void => {
    consumeSlashRange(editor, range);
    void openEditorDialog({ kind: 'citation', title: 'Citation' }).then((raw) => {
      const result = asFormResult(raw);
      if (!result) return;
      const author = result.author?.trim() ?? '';
      const title = result.title?.trim() ?? '';
      const year = Number.parseInt(result.year ?? '', 10);
      if (!author || !title || Number.isNaN(year)) return;
      const doi = result.doi?.trim() ? result.doi.trim() : null;
      const pubmed = result.pubmed?.trim() ? result.pubmed.trim() : null;
      const ref = { authors: [author], title, year };
      void Promise.all([
        import('@/lib/citations/format'),
        import('./extensions/citation').then((m) => m.CitationExtension),
      ]).then(([fmt, CitationExt]) => {
        if (editor.isDestroyed) return;
        consumeSlashRange(editor, range);
        if (!editor.extensionManager.extensions.some((e) => e.name === CitationExt.name)) {
          editor.setOptions({ extensions: [...editor.extensionManager.extensions, CitationExt] });
        }
        const fullRef = { ...ref, doi: doi ?? undefined, pubmedId: pubmed ?? undefined };
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'citation',
            attrs: {
              id: crypto.randomUUID(),
              doi,
              pubmed_id: pubmed,
              formatted_apa: fmt.formatCitation(fullRef, 'apa'),
              formatted_mla: fmt.formatCitation(fullRef, 'mla'),
              formatted_chicago: fmt.formatCitation(fullRef, 'chicago'),
              raw_authors: [author],
              raw_title: title,
              raw_year: year,
            },
          })
          .run();
      });
    });
  },
};

/**
 * v0.9.7 G19 #166 — DOI / PubMed citation lookup slash entry.
 *
 * Opens the P21 `CitationAddDialog` via the editor dialog bus, awaits the
 * resolved `CitationMeta`, lazily registers `CitationExtension` (so the React
 * node-view + Add-citation affordance render), recomputes all three style
 * variants from the meta, and inserts a `citation` node. Distinct from the
 * manual-entry `/citation` item above (which collects free-text author/title).
 */
export const citationLookupMenuItem: CitationSlashEntry = {
  command: '/cite-doi',
  title: 'Citation (DOI/PubMed lookup)',
  description: 'Look up a reference by DOI or PubMed ID',
  icon: BookMarked,
  keywords: ['cite', 'doi', 'pubmed', 'lookup', 'reference', 'crossref'],
  run: (editor: Editor, range?: SlashRange): void => {
    void openEditorDialog({
      kind: 'citationLookup',
      title: 'Citation (DOI/PubMed lookup)',
    }).then((result) => {
      if (!result || !('kind' in result) || result.kind !== 'citationLookup') return;
      const { meta } = result as EditorDialogCitationResult;
      void Promise.all([
        import('@/lib/citations/format'),
        import('./extensions/citation').then((m) => m.CitationExtension),
      ]).then(([fmt, CitationExt]) => {
        if (editor.isDestroyed) return;
        consumeSlashRange(editor, range);
        if (!editor.extensionManager.extensions.some((e) => e.name === CitationExt.name)) {
          editor.setOptions({
            extensions: [...editor.extensionManager.extensions, CitationExt],
          });
        }
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'citation',
            attrs: {
              id: meta.doi ?? meta.pmid ?? crypto.randomUUID(),
              doi: meta.doi ?? null,
              pubmed_id: meta.pmid ?? null,
              formatted_apa: fmt.formatApa(meta),
              formatted_mla: fmt.formatMla(meta),
              formatted_chicago: fmt.formatChicago(meta),
              raw_authors: meta.authors.map((a) =>
                a.given ? `${a.family}, ${a.given}` : a.family,
              ),
              raw_title: meta.title,
              raw_year: meta.year ?? null,
            },
          })
          .run();
      });
    });
  },
};

function toSlashItem(entry: CitationSlashEntry, category: SlashCategory): SlashItem {
  return {
    title: entry.title,
    description: entry.description,
    category,
    command: entry.run,
    icon: entry.icon,
    // #38 — every CitationSlashEntry opens a dialog/lookup that can be
    // cancelled, so they are all deferred: the trigger range is deleted inside
    // `run` only after a successful insert.
    deferred: true,
    keywords: entry.keywords ?? [],
  };
}

/**
 * v0.9.0 G3 P20 — `/datetime` slash entry. Inserts a timezone-aware date/time
 * inline atom defaulting to "now" in the browser's resolved IANA zone. The
 * lazy `datetime` extension is loaded on demand so the popover picker + Luxon
 * helpers stay out of the initial editor bundle.
 */
export const datetimeMenuItem: CitationSlashEntry = {
  command: '/datetime',
  title: 'Date/time',
  description: 'Insert a date/time with timezone',
  icon: CalendarClock,
  keywords: ['date', 'time', 'now', 'timestamp'],
  run: (editor: Editor, range?: SlashRange): void => {
    void ensureLazyExtension(editor, 'datetime').then(async () => {
      if (editor.isDestroyed) return;
      consumeSlashRange(editor, range);
      const { parseInput, DEFAULT_DISPLAY_FORMAT } = await import('@/lib/datetime/format');
      const now = new Date();
      const tz =
        typeof Intl !== 'undefined' && Intl.DateTimeFormat
          ? (Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC')
          : 'UTC';
      // Convert the current instant into the resolved tz's wall-clock so
      // parseInput round-trips back to (roughly) the same UTC instant.
      const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
      const pad = (n: number) => String(n).padStart(2, '0');
      const date = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
      const time = `${pad(local.getHours())}:${pad(local.getMinutes())}`;
      let iso: string;
      try {
        iso = parseInput({ date, time, tz });
      } catch {
        iso = now.toISOString();
      }
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'datetime',
          attrs: { iso, tz, display_format: DEFAULT_DISPLAY_FORMAT },
        })
        .run();
    });
  },
};

export const pdfSlashItem: SlashItem = {
  title: 'PDF',
  description: 'Upload a PDF and annotate it inline',
  category: 'media',
  icon: FileText,
  keywords: ['pdf', 'document', 'attachment'],
  // #38 — deferred: opens a (cancelable) file picker + async upload; the
  // trigger range is consumed only once the upload succeeds and we insert.
  deferred: true,
  command: (editor, range) => {
    void (async () => {
      await ensureLazyExtension(editor, 'pdf');
      if (editor.isDestroyed) return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/pdf';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const fd = new FormData();
        fd.set('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        if (!res.ok) return;
        const { file: meta } = (await res.json()) as { file: { id: string; name: string } };
        consumeSlashRange(editor, range);
        editor.chain().focus().setPdf({ fileId: meta.id, defaultPage: 1 }).run();
      };
      input.click();
    })();
  },
};

const items: SlashItem[] = [
  {
    title: 'Heading 1',
    description: 'Large section header',
    category: 'basic',
    icon: Heading1,
    command: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    keywords: ['h1', 'title', 'header'],
  },
  {
    title: 'Heading 2',
    description: 'Medium section header',
    category: 'basic',
    icon: Heading2,
    command: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    keywords: ['h2', 'subheader'],
  },
  {
    title: 'Heading 3',
    description: 'Small section header',
    category: 'basic',
    icon: Heading3,
    command: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    keywords: ['h3', 'subheader'],
  },
  {
    title: 'Bullet list',
    description: 'Simple bulleted list',
    category: 'basic',
    icon: List,
    command: (editor) => editor.chain().focus().toggleBulletList().run(),
    keywords: ['ul', 'unordered', 'bullets'],
  },
  {
    title: 'Numbered list',
    description: 'Ordered list',
    category: 'basic',
    icon: ListOrdered,
    command: (editor) => editor.chain().focus().toggleOrderedList().run(),
    keywords: ['ol', 'ordered', 'number'],
  },
  {
    title: 'Checkbox list',
    description: 'Inline checkbox list (for /my-tasks see the sidebar)',
    category: 'basic',
    icon: ListChecks,
    command: (editor) => editor.chain().focus().toggleTaskList().run(),
    keywords: ['check', 'todo', 'checkbox', 'checklist', 'task'],
  },
  {
    title: 'Quote',
    description: 'Block quote',
    category: 'basic',
    icon: Quote,
    command: (editor) => editor.chain().focus().toggleBlockquote().run(),
    keywords: ['blockquote', 'citation'],
  },
  {
    title: 'Code',
    description: 'Code block with syntax highlight',
    category: 'basic',
    icon: Code,
    command: (editor) => editor.chain().focus().toggleCodeBlock().run(),
    keywords: ['snippet', 'pre', 'monospace'],
  },
  {
    title: 'Divider',
    description: 'Horizontal rule',
    category: 'basic',
    icon: Minus,
    command: (editor) => editor.chain().focus().setDivider().run(),
    keywords: ['hr', 'line', 'rule', 'separator'],
  },
  {
    title: 'Callout',
    description: 'Highlighted aside',
    category: 'basic',
    icon: Info,
    command: (editor) => editor.chain().focus().setCallout('note').run(),
    keywords: ['note', 'aside', 'admonition', 'info'],
  },
  {
    title: 'Toggle',
    description: 'Collapsible block',
    category: 'basic',
    icon: ChevronRight,
    command: (editor) => editor.chain().focus().setToggle().run(),
    keywords: ['collapse', 'collapsible', 'accordion', 'details'],
  },
  {
    title: 'Columns',
    description: 'Two side-by-side columns',
    category: 'basic',
    icon: Columns2,
    command: (editor) => editor.chain().focus().setColumns(2).run(),
    keywords: ['cols', 'grid', 'layout'],
  },
  {
    title: 'Table',
    description: 'Simple table',
    category: 'database',
    icon: Table,
    command: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    keywords: ['grid', 'spreadsheet'],
  },
  {
    title: 'Image',
    description: 'Upload and embed an image',
    category: 'media',
    icon: Image,
    deferred: true,
    command: (editor, range) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const fd = new FormData();
        fd.set('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        if (!res.ok) return;
        const { signedUrl, file: meta } = (await res.json()) as {
          signedUrl: string;
          file: { id: string; name: string };
        };
        consumeSlashRange(editor, range);
        editor
          .chain()
          .focus()
          .insertCairnImage({ src: signedUrl, alt: meta.name, fileId: meta.id })
          .run();
      };
      input.click();
    },
    keywords: ['img', 'picture', 'photo'],
  },
  {
    title: 'File',
    description: 'Attach a file as a downloadable link',
    category: 'media',
    icon: Paperclip,
    deferred: true,
    command: (editor, range) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const fd = new FormData();
        fd.set('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        if (!res.ok) return;
        const { signedUrl, file: meta } = (await res.json()) as {
          signedUrl: string;
          file: { id: string; name: string; mimeType: string; size: number };
        };
        consumeSlashRange(editor, range);
        editor
          .chain()
          .focus()
          .insertFile({
            href: signedUrl,
            name: meta.name,
            mimeType: meta.mimeType,
            size: meta.size,
            fileId: meta.id,
          })
          .run();
      };
      input.click();
    },
    keywords: ['attachment', 'upload', 'document'],
  },
  {
    title: 'Embed',
    description: 'Embed a YouTube/Vimeo/Loom/Figma/gist/CodeSandbox/Codepen/Spotify/Excalidraw URL',
    category: 'media',
    icon: Code2,
    deferred: true,
    command: (editor, range) => {
      void ensureLazyExtension(editor, 'embed').then(() => {
        if (editor.isDestroyed) return;
        consumeSlashRange(editor, range);
        editor
          .chain()
          .focus()
          .insertContent({ type: 'embed', attrs: { provider: null, src: null } })
          .run();
      });
    },
    keywords: ['iframe', 'youtube', 'vimeo', 'video', 'figma'],
  },
  {
    title: 'Bookmark',
    description: 'Save a link as a rich preview card',
    category: 'media',
    icon: Bookmark,
    command: (editor) => editor.chain().focus().setBookmark('').run(),
    keywords: ['link', 'url', 'preview'],
  },
  {
    title: 'Button',
    description: 'Inline CTA with optional URL',
    category: 'media',
    icon: MousePointerClick,
    command: (editor) => editor.chain().focus().setButton().run(),
    keywords: ['cta', 'link', 'action'],
  },
  {
    title: 'Video',
    description: 'Upload an MP4 or WebM video',
    category: 'media',
    icon: Video,
    command: (editor) => editor.chain().focus().setVideo().run(),
    keywords: ['mp4', 'webm', 'movie', 'clip'],
  },
  {
    title: 'Audio',
    description: 'Upload and embed an audio file (mp3/wav/ogg/flac/aac)',
    category: 'media',
    icon: Music,
    deferred: true,
    command: (editor, range) => {
      // v0.9.0 G3 P22: load the React node-view first so the inserted node
      // renders with the signed-URL `<audio>` element instead of the bare
      // schema div. Pattern mirrors the embed/math slash entries.
      void ensureLazyExtension(editor, 'cairnAudio').then(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/aac';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          const fd = new FormData();
          fd.set('file', file);
          const res = await fetch('/api/upload', { method: 'POST', body: fd });
          if (!res.ok) return;
          const { file: meta } = (await res.json()) as {
            signedUrl: string;
            file: { id: string; name: string; mimeType: string };
          };
          consumeSlashRange(editor, range);
          editor
            .chain()
            .focus()
            .setAudio({ fileId: meta.id, mime: meta.mimeType, name: meta.name })
            .run();
        };
        input.click();
      });
    },
    keywords: ['sound', 'mp3', 'music', 'podcast'],
  },
  {
    title: 'Equation',
    description: 'Block math rendered with KaTeX',
    category: 'advanced',
    icon: Sigma,
    deferred: true,
    // v0.9.9 E1a (#246/#274) — modal-first: collect LaTeX (+ display toggle)
    // with a live KaTeX preview, then lazy-load `math` and insert a POPULATED
    // node. No more empty-node-then-click. The trigger range is consumed only
    // once the dialog resolves to a real insert (restore-on-cancel via #38).
    command: (editor, range) => {
      void openEditorDialog({ kind: 'equation', title: 'Insert equation' }).then((raw) => {
        if (!raw || !('kind' in raw) || raw.kind !== 'equation') return;
        const { latex, display } = raw as EditorDialogEquationResult;
        if (!latex.trim()) return;
        void ensureLazyExtension(editor, 'math').then(() => {
          if (editor.isDestroyed) return;
          consumeSlashRange(editor, range);
          editor.chain().focus().setMath({ latex, display }).run();
        });
      });
    },
    keywords: ['math', 'latex', 'katex', 'formula'],
  },
  {
    title: 'Synced block',
    description: 'Reusable block mirrored elsewhere on this page',
    category: 'advanced',
    icon: RefreshCw,
    deferred: true,
    command: (editor, range) => {
      void ensureLazyExtension(editor, 'syncedBlock').then(() => {
        if (editor.isDestroyed) return;
        consumeSlashRange(editor, range);
        editor.chain().focus().setSyncedBlock().run();
      });
    },
    keywords: ['sync', 'mirror', 'reusable'],
  },
  {
    title: 'Mermaid diagram',
    description: 'Render a Mermaid diagram (flowchart, sequence, ER) as SVG',
    category: 'advanced',
    icon: Workflow,
    deferred: true,
    command: (editor, range) => {
      void ensureLazyExtension(editor, 'mermaid').then(() => {
        if (editor.isDestroyed) return;
        consumeSlashRange(editor, range);
        editor.chain().focus().setMermaid().run();
      });
    },
    keywords: ['diagram', 'flowchart', 'chart', 'graph'],
  },
  {
    title: 'PlantUML diagram',
    description: 'Render PlantUML (sequence, use-case, class) via public or self-hosted server',
    category: 'advanced',
    icon: Network,
    deferred: true,
    command: (editor, range) => {
      void ensureLazyExtension(editor, 'plantuml').then(() => {
        if (editor.isDestroyed) return;
        consumeSlashRange(editor, range);
        editor.chain().focus().setPlantUml().run();
      });
    },
    keywords: ['diagram', 'uml', 'sequence'],
  },
  {
    title: 'drawio diagram',
    description: 'Embed a viewer-only diagrams.net diagram (XML or public URL)',
    category: 'advanced',
    icon: PenTool,
    deferred: true,
    command: (editor, range) => {
      void ensureLazyExtension(editor, 'drawio').then(() => {
        if (editor.isDestroyed) return;
        consumeSlashRange(editor, range);
        editor.chain().focus().setDrawio().run();
      });
    },
    keywords: ['diagram', 'diagrams.net', 'drawio'],
  },
  {
    title: 'Image gallery',
    description: 'Drop multiple images into a responsive grid with click-to-zoom',
    category: 'media',
    icon: Images,
    deferred: true,
    command: (editor, range) => {
      void ensureLazyExtension(editor, 'gallery').then(() => {
        if (editor.isDestroyed) return;
        consumeSlashRange(editor, range);
        editor.chain().focus().setGallery().run();
      });
    },
    keywords: ['gallery', 'grid', 'photos', 'album'],
  },
  pdfSlashItem,
  toSlashItem(footnoteMenuItem, 'advanced'),
  toSlashItem(citationMenuItem, 'advanced'),
  toSlashItem(citationLookupMenuItem, 'advanced'),
  toSlashItem(datetimeMenuItem, 'advanced'),
  {
    title: 'Flashcard',
    description: 'Spaced-repetition flashcard (front / back / deck tag)',
    category: 'advanced',
    icon: Layers,
    deferred: true,
    command: (editor, range) => {
      void openEditorDialog({ kind: 'flashcard', title: 'Flashcard' }).then((raw) => {
        const result = asFormResult(raw);
        if (!result) return;
        const { front, back, deck } = result;
        if (!front || !back) return;
        void ensureLazyExtension(editor, 'flashcard').then(() => {
          if (editor.isDestroyed) return;
          consumeSlashRange(editor, range);
          editor
            .chain()
            .focus()
            .setFlashcard({ front, back, deckTag: deck || null })
            .run();
        });
      });
    },
    keywords: ['anki', 'card', 'spaced', 'srs'],
  },
  {
    title: 'Table of contents',
    description: "Linked outline of this page's headings",
    category: 'basic',
    icon: ListTree,
    command: (editor) => editor.chain().focus().insertTableOfContents().run(),
    keywords: ['toc', 'outline', 'index'],
  },
  {
    title: 'Database',
    description: 'Inline database with table/kanban/gallery',
    category: 'database',
    icon: Database,
    deferred: true,
    command: (editor, range) => {
      void (async () => {
        const pageId = (editor.storage as { cairn?: { pageId?: string } }).cairn?.pageId;
        if (!pageId) return;
        const res = await fetch('/api/databases', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pageId }),
        });
        if (!res.ok) return;
        const { id } = (await res.json()) as { id: string };
        if (editor.isDestroyed) return;
        consumeSlashRange(editor, range);
        editor
          .chain()
          .focus()
          .insertContent({ type: 'database', attrs: { databaseId: id } })
          .run();
      })();
    },
    keywords: ['db', 'table', 'kanban', 'collection'],
  },
  {
    title: 'Page embed',
    description: 'Embed a link to another page as a preview card',
    category: 'database',
    icon: FileSymlink,
    deferred: true,
    command: (editor, range) => {
      openPagePicker(editor, (item) => {
        consumeSlashRange(editor, range);
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'pageEmbed',
            attrs: { targetPageId: item.id, label: item.title || 'Untitled' },
          })
          .run();
      });
    },
    keywords: ['page', 'subpage', 'link', 'mention'],
  },
];

/**
 * #148 — slash-menu search predicate. Matches `query` (case-insensitive
 * substring) against the item title OR any of its keyword aliases. An empty
 * query matches everything. Exported so the suggestion `items()` filter and
 * the unit test share one source of truth.
 */
export function matchesSlashQuery(item: SlashItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (item.title.toLowerCase().includes(q)) return true;
  return item.keywords.some((k) => k.toLowerCase().includes(q));
}

/** The full, ordered slash-command catalog. Exported for tests + reuse. */
export const SLASH_ITEMS: SlashItem[] = items;

/**
 * #38 — correct the suggestion-provided range so it ALWAYS spans the leading
 * `/` trigger. In non-paragraph blocks (headings, list items, blockquotes) the
 * @tiptap/suggestion match range sometimes starts one position AFTER the `/`,
 * so the old unconditional `deleteRange(range)` left a stray `/` and merged the
 * query text into the new block. We re-scan the character immediately before
 * `range.from`: if it's the `/` trigger, widen the range to include it.
 */
export function slashTriggerRange(editor: Editor, range: SlashRange): SlashRange {
  const { from } = range;
  if (from <= 1) return range;
  const charBefore = editor.state.doc.textBetween(from - 1, from, undefined, '￼');
  if (charBefore === '/') {
    return { from: from - 1, to: range.to };
  }
  return range;
}

/**
 * #38/#76/#77/#111/#112 — single dispatch for a chosen slash item. This is the
 * correctness core extracted for unit testing.
 *
 * - SYNCHRONOUS items (immediate insert): delete the corrected trigger range
 *   FIRST, then run the command — the insert happens synchronously so the
 *   trigger is consumed and nothing is left behind.
 * - DEFERRED items (`deferred: true` — dialogs, file pickers, lazy/async
 *   inserts): do NOT pre-delete. We hand the corrected range to the command,
 *   which deletes it itself ONLY when it actually commits an insert. On
 *   cancel/early-return the `/query` text is left intact (no lone `/`).
 */
export function runSlashItem(args: { editor: Editor; range: SlashRange; item: SlashItem }): void {
  const { editor, item } = args;
  const range = slashTriggerRange(editor, args.range);
  if (item.deferred) {
    item.command(editor, range);
    return;
  }
  editor.chain().focus().deleteRange(range).run();
  item.command(editor);
}

/**
 * Delete the slash `/query` trigger range from inside a DEFERRED command, at the
 * point it is about to insert. Safe no-op if `range` is undefined (e.g. the
 * command was invoked outside the slash menu). Use as the first link of the
 * insertion chain so the trigger text is consumed atomically with the insert.
 */
export function consumeSlashRange(editor: Editor, range: SlashRange | undefined): void {
  if (!range) return;
  editor.chain().focus().deleteRange(range).run();
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions(): { suggestion: Partial<SuggestionOptions<SlashItem, SlashItem>> } {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        // #38/#76/#77/#111/#112 — delegate to the shared dispatch: correct the
        // range to include the `/` trigger, and only delete it for synchronous
        // inserts. Deferred items (dialogs/pickers/lazy) delete the range
        // themselves on success, so a cancel leaves the typed text intact.
        command: ({ editor, range, props }) => {
          runSlashItem({ editor, range, item: props });
        },
        // #122 — return the full filtered catalog (no slice cap). The grouped,
        // scrollable SlashMenu bounds its own height, so every block is now
        // discoverable both by scrolling categories and by typing.
        items: ({ query }) => items.filter((i) => matchesSlashQuery(i, query)),
        render: () => {
          let component: ReactRenderer<
            SlashMenuRef,
            { items: SlashItem[]; command: (i: SlashItem) => void }
          >;
          let popup: Instance<TippyProps>;
          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenu, {
                props: { items: props.items, command: (i: SlashItem) => props.command(i) },
                editor: props.editor,
              });
              popup = tippy(document.body, {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              });
              // #110/#133 — tag the rendered .tippy-box so globals.css can
              // exclude the slash popup from the global :focus-visible ring
              // (the saturated accent ring on this floating surface read as a
              // stuck viewport edge-glow after teardown returned focus to it).
              popup.popper.firstElementChild?.classList.add('cairn-slash-popup');
            },
            onUpdate: (props) => {
              component.updateProps({
                items: props.items,
                command: (i: SlashItem) => props.command(i),
              });
              popup.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') {
                popup.hide();
                return true;
              }
              return component.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: () => {
              popup.destroy();
              component.destroy();
            },
          };
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      } as SuggestionOptions<SlashItem, SlashItem>),
    ];
  },
});

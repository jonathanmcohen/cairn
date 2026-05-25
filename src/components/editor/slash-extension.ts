import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import tippy, { type Instance, type Props as TippyProps } from 'tippy.js';
import { type LazyEditorNodeName, loadEditorExtension } from './extensions-lazy';
import { type PageItem, PageLinkList, type PageLinkListRef } from './page-link-list';
import { fetchPages } from './page-link-suggestion';
import { type SlashItem, SlashMenu, type SlashMenuRef } from './slash-menu';

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

const items: SlashItem[] = [
  {
    title: 'Heading 1',
    description: 'Large section header',
    command: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    description: 'Medium section header',
    command: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    description: 'Small section header',
    command: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    title: 'Bullet list',
    description: 'Simple bulleted list',
    command: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: 'Numbered list',
    description: 'Ordered list',
    command: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: 'Task list',
    description: 'Checkbox list',
    command: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    title: 'Quote',
    description: 'Block quote',
    command: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    title: 'Code',
    description: 'Code block with syntax highlight',
    command: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: 'Divider',
    description: 'Horizontal rule',
    command: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    title: 'Callout',
    description: 'Highlighted aside',
    command: (editor) => editor.chain().focus().setCallout('default').run(),
  },
  {
    title: 'Toggle',
    description: 'Collapsible block',
    command: (editor) => editor.chain().focus().setToggle().run(),
  },
  {
    title: 'Columns',
    description: 'Two side-by-side columns',
    command: (editor) => editor.chain().focus().setColumns(2).run(),
  },
  {
    title: 'Table',
    description: 'Simple table',
    command: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    title: 'Image',
    description: 'Upload and embed an image',
    command: (editor) => {
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
        editor
          .chain()
          .focus()
          .insertCairnImage({ src: signedUrl, alt: meta.name, fileId: meta.id })
          .run();
      };
      input.click();
    },
  },
  {
    title: 'File',
    description: 'Attach a file as a downloadable link',
    command: (editor) => {
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
  },
  {
    title: 'Embed',
    description: 'Embed a YouTube, Vimeo, Figma, gist, or CodeSandbox URL',
    command: (editor) => {
      void ensureLazyExtension(editor, 'embed').then(() => {
        editor
          .chain()
          .focus()
          .insertContent({ type: 'embed', attrs: { provider: null, src: null } })
          .run();
      });
    },
  },
  {
    title: 'Bookmark',
    description: 'Save a link as a rich preview card',
    command: (editor) => editor.chain().focus().setBookmark('').run(),
  },
  {
    title: 'Equation',
    description: 'Block math rendered with KaTeX',
    command: (editor) => {
      void ensureLazyExtension(editor, 'math').then(() => {
        editor.chain().focus().setMath({ latex: '', display: true }).run();
      });
    },
  },
  {
    title: 'Synced block',
    description: 'Reusable block mirrored elsewhere on this page',
    command: (editor) => {
      void ensureLazyExtension(editor, 'syncedBlock').then(() => {
        editor.chain().focus().setSyncedBlock().run();
      });
    },
  },
  {
    title: 'Table of contents',
    description: "Linked outline of this page's headings",
    command: (editor) => editor.chain().focus().insertTableOfContents().run(),
  },
  {
    title: 'Database',
    description: 'Inline database with table/kanban/gallery',
    command: (editor) => {
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
        editor
          .chain()
          .focus()
          .insertContent({ type: 'database', attrs: { databaseId: id } })
          .run();
      })();
    },
  },
  {
    title: 'Page embed',
    description: 'Embed a link to another page as a preview card',
    command: (editor) => {
      openPagePicker(editor, (item) => {
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
  },
];

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions(): { suggestion: Partial<SuggestionOptions<SlashItem, SlashItem>> } {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.command(editor);
        },
        items: ({ query }) =>
          items.filter((i) => i.title.toLowerCase().includes(query.toLowerCase())).slice(0, 10),
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

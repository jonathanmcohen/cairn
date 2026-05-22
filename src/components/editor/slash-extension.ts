import { Extension } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import tippy, { type Instance, type Props as TippyProps } from 'tippy.js';
import { type SlashItem, SlashMenu, type SlashMenuRef } from './slash-menu';

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

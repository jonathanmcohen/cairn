import { Extension } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import tippy, { type Instance, type Props as TippyProps } from 'tippy.js';
import { type PageItem, PageLinkList, type PageLinkListRef } from './page-link-list';

export async function fetchPages(query: string): Promise<PageItem[]> {
  try {
    const res = await fetch(`/api/workspaces/pages?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { pages?: PageItem[] };
    return data.pages ?? [];
  } catch {
    return [];
  }
}

function makeRenderer(): SuggestionOptions<PageItem, PageItem>['render'] {
  return () => {
    let component: ReactRenderer<
      PageLinkListRef,
      { items: PageItem[]; command: (i: PageItem) => void }
    >;
    let popup: Instance<TippyProps>;
    return {
      onStart: (props) => {
        component = new ReactRenderer(PageLinkList, {
          props: {
            items: props.items,
            command: (i: PageItem) => props.command(i),
          },
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
          command: (i: PageItem) => props.command(i),
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
  };
}

function suggestionFor(
  char: string,
  nodeType: 'pageLink' | 'pageMention',
): Omit<SuggestionOptions<PageItem, PageItem>, 'editor'> {
  return {
    char,
    items: ({ query }) => fetchPages(query),
    command: ({ editor, range, props }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: nodeType, attrs: { targetPageId: props.id, label: props.title || 'Untitled' } },
          { type: 'text', text: ' ' },
        ])
        .run();
    },
    render: makeRenderer(),
  };
}

/**
 * Registers the `[[` (pageLink) and `@@` (pageMention) page-picker suggestions.
 * `@@` is used instead of `@` so it does not collide with the v0.3.0 member
 * `@`-mention (`mention-extension.ts`).
 */
export const PageLinkSuggestion = Extension.create({
  name: 'pageLinkSuggestion',
  addProseMirrorPlugins() {
    return [
      Suggestion({ editor: this.editor, ...suggestionFor('[[', 'pageLink') }),
      Suggestion({ editor: this.editor, ...suggestionFor('@@', 'pageMention') }),
    ];
  },
});

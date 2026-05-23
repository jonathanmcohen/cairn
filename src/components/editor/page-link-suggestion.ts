import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import tippy, { type Instance, type Props as TippyProps } from 'tippy.js';
import { type PageItem, PageLinkList, type PageLinkListRef } from './page-link-list';

// Each Suggestion plugin MUST have a distinct PluginKey — `@tiptap/suggestion`
// defaults to `PluginKey('suggestion')`, so two instances with that default key
// crash at editor-mount time ("Adding different instances of a keyed plugin").
// Member-mentions use 'mention$' (configured in mention-extension.ts).
const PAGE_LINK_PLUGIN_KEY = new PluginKey('pageLinkSuggestion$');
const PAGE_MENTION_PLUGIN_KEY = new PluginKey('pageMentionSuggestion$');

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
      Suggestion({
        editor: this.editor,
        pluginKey: PAGE_LINK_PLUGIN_KEY,
        ...suggestionFor('[[', 'pageLink'),
      }),
      Suggestion({
        editor: this.editor,
        pluginKey: PAGE_MENTION_PLUGIN_KEY,
        ...suggestionFor('@@', 'pageMention'),
      }),
    ];
  },
});

import Mention from '@tiptap/extension-mention';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import type { SuggestionOptions } from '@tiptap/suggestion';
import tippy, { type Instance, type Props as TippyProps } from 'tippy.js';
import { type MentionItem, MentionList, type MentionListRef } from './mention-list';

// Distinct PluginKey so this Suggestion plugin doesn't collide with the page-link
// `[[`/`@@` suggestions (page-link-suggestion.ts). All three share `@tiptap/suggestion`
// which defaults to `PluginKey('suggestion')`; without unique keys the editor crashes
// at mount with "Adding different instances of a keyed plugin (suggestion$)".
const MENTION_PLUGIN_KEY = new PluginKey('mentionSuggestion$');

async function fetchMembers(query: string): Promise<MentionItem[]> {
  try {
    const res = await fetch(`/api/workspaces/members?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { members?: MentionItem[] };
    return data.members ?? [];
  } catch {
    return [];
  }
}

export const MentionExtension = Mention.configure({
  // `mention` is the default node name; keep it.
  HTMLAttributes: { class: 'mention' },
  // Serialize the node to our storage convention `@[Name](userId)` so
  // extractMentions + plain-text/FTS see a stable, parseable token.
  renderText({ node }) {
    return `@[${node.attrs.label ?? node.attrs.id}](${node.attrs.id})`;
  },
  // Store id (userId) + label on the node; render as a styled, inert link.
  renderHTML({ options, node }) {
    return [
      'a',
      {
        ...options.HTMLAttributes,
        // Inert link for now — no profile page yet; hover shows the name.
        href: '#',
        'data-mention-id': node.attrs.id,
        title: node.attrs.label ?? node.attrs.id,
      },
      `@${node.attrs.label ?? node.attrs.id}`,
    ];
  },
  suggestion: {
    pluginKey: MENTION_PLUGIN_KEY,
    char: '@',
    // The Mention node reads `props.id` + `props.label`; map our member shape.
    command: ({ editor, range, props }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: 'mention', attrs: { id: props.id, label: props.label } },
          { type: 'text', text: ' ' },
        ])
        .run();
    },
    items: async ({ query }) => {
      const members = await fetchMembers(query);
      // Suggestion props need `id` + `label`; carry the rest for the list UI.
      return members.map((m) => ({ ...m, label: m.name }));
    },
    render: () => {
      let component: ReactRenderer<
        MentionListRef,
        { items: MentionItem[]; command: (i: MentionItem) => void }
      >;
      let popup: Instance<TippyProps>;
      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, {
            props: {
              items: props.items as MentionItem[],
              command: (i: MentionItem) => props.command({ id: i.id, label: i.name }),
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
            items: props.items as MentionItem[],
            command: (i: MentionItem) => props.command({ id: i.id, label: i.name }),
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
  } satisfies Partial<SuggestionOptions>,
});

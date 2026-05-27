import { mergeAttributes, Node } from '@tiptap/core';
import { DEFAULT_DISPLAY_FORMAT } from '@/lib/datetime/format';

/**
 * Schema-only definition of the `datetime` inline-atom node (v0.9.0 G3 P20).
 *
 * Attrs:
 *  - `iso`            — UTC instant ISO string (e.g. `2026-05-26T15:00:00.000Z`).
 *  - `tz`             — IANA tz id the value was authored in (e.g.
 *                       `America/New_York`). Carried for display + bibliographic
 *                       context; the value itself is always the UTC instant.
 *  - `display_format` — Luxon token-format string. Defaults to
 *                       `'yyyy-LL-dd HH:mm'`. Honored by the renderer + markdown
 *                       export.
 *
 * All three attrs are plain strings, so y-prosemirror syncs them losslessly
 * (Yjs-safe; no node-local mutable state).
 *
 * Schema-only: the React node-view (`DateTimeView` + popover picker) lives in
 * `src/components/editor/extensions/datetime.tsx` and is wired by the editor.
 */
export const DateTimeNode = Node.create({
  name: 'datetime',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      iso: { default: '' },
      tz: { default: 'UTC' },
      display_format: { default: DEFAULT_DISPLAY_FORMAT },
    };
  },

  parseHTML() {
    return [{ tag: 'time[datetime]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'time',
      mergeAttributes(HTMLAttributes, {
        datetime: String(HTMLAttributes.iso ?? ''),
        'data-tz': String(HTMLAttributes.tz ?? 'UTC'),
        'data-format': String(HTMLAttributes.display_format ?? DEFAULT_DISPLAY_FORMAT),
        class: 'cairn-datetime',
      }),
    ];
  },
});

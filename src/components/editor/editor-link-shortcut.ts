import { Extension } from '@tiptap/core';

/**
 * #117 — Editor link shortcut.
 *  - `Mod-Shift-k` always opens the link input (the dedicated, palette-safe key).
 *  - `Mod-k` opens the link input ONLY when there is a non-empty text selection;
 *    with a collapsed caret it returns `false` so the event bubbles to the global
 *    ⌘K search-palette handler (search-palette.tsx). This is the documented
 *    tie-break: ranged ⌘K inside the editor = link; everything else = palette.
 *
 * The extension is presentation-free: it dispatches a `cairn:editor:open-link`
 * CustomEvent that the editor surface listens for to open the bubble-menu link
 * popover. Keeping it event-based avoids holding React state in a ProseMirror
 * extension and stays Yjs-safe (no schema, no node-local state).
 */
function openLink(): boolean {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cairn:editor:open-link'));
  }
  return true;
}

export const EditorLinkShortcut = Extension.create({
  name: 'cairnLinkShortcut',
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-k': () => openLink(),
      'Mod-k': () => {
        if (this.editor.state.selection.empty) return false; // let palette handle ⌘K
        return openLink();
      },
    };
  },
});

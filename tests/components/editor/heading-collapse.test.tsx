// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';
import { HeadingCollapse } from '@/components/editor/heading-collapse';

vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

let editor: Editor;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: baseExtensions({ undoRedo: true }),
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'B' }] },
      ],
    },
  });
});

afterEach(() => {
  cleanup();
  editor.destroy();
  host.remove();
});

function hoverFirstHeading() {
  const h2 = editor.view.dom.querySelector('h2') as HTMLElement;
  // Dispatch a bubbling mousemove on the heading so it reaches the listener on
  // editor.view.dom with e.target === the heading.
  fireEvent.mouseMove(h2);
}

// The collapse state is now owned by ProseMirror (#117): toggling dispatches a
// plugin transaction and a `decorations` prop stamps `hidden` +
// `data-cairn-collapsed` onto the affected blocks. Because the same `<p>` DOM
// element is re-decorated (not recreated), we re-query it after each toggle to
// read the *current* decorated DOM rather than holding a stale reference.
function paragraph(): HTMLElement {
  return editor.view.dom.querySelector('p') as HTMLElement;
}
function secondHeadingEl(): HTMLElement {
  return editor.view.dom.querySelectorAll('h2')[1] as HTMLElement;
}

describe('<HeadingCollapse> (#276 / #117)', () => {
  it('reveals a collapse chevron on heading hover and toggles the section', () => {
    render(<HeadingCollapse editor={editor} />);
    hoverFirstHeading();

    const collapseBtn = screen.getByLabelText('editor.heading.collapse');
    expect(collapseBtn).toBeTruthy();

    expect(paragraph().hasAttribute('hidden')).toBe(false);
    expect(paragraph().hasAttribute('data-cairn-collapsed')).toBe(false);

    // Collapse: the following paragraph is hidden via PM decorations, and the
    // collapse STICKS (PM owns the state, so a redraw can't wipe it).
    fireEvent.click(collapseBtn);
    expect(paragraph().hasAttribute('hidden')).toBe(true);
    expect(paragraph().hasAttribute('data-cairn-collapsed')).toBe(true);
    // The second heading B is NOT hidden (equal level stops the collapse).
    expect(secondHeadingEl().hasAttribute('hidden')).toBe(false);

    // After collapse the button flips to "expand".
    const expandBtn = screen.getByLabelText('editor.heading.expand');
    fireEvent.click(expandBtn);
    expect(paragraph().hasAttribute('hidden')).toBe(false);
    expect(paragraph().hasAttribute('data-cairn-collapsed')).toBe(false);
  });

  it('keeps the collapse after a document redraw (the #117 regression)', () => {
    render(<HeadingCollapse editor={editor} />);
    hoverFirstHeading();
    fireEvent.click(screen.getByLabelText('editor.heading.collapse'));
    expect(paragraph().hasAttribute('hidden')).toBe(true);

    // Force a doc transaction (the kind of redraw that previously wiped the raw
    // DOM attributes). The decoration is re-derived from plugin state, so the
    // paragraph stays hidden and its position is remapped through the edit.
    editor.commands.insertContentAt(editor.state.doc.content.size, ' more');
    expect(paragraph().hasAttribute('hidden')).toBe(true);
    expect(paragraph().hasAttribute('data-cairn-collapsed')).toBe(true);
  });
});

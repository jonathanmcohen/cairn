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

describe('<HeadingCollapse> (#276)', () => {
  it('reveals a collapse chevron on heading hover and toggles the section', () => {
    render(<HeadingCollapse editor={editor} />);
    hoverFirstHeading();

    const collapseBtn = screen.getByLabelText('editor.heading.collapse');
    expect(collapseBtn).toBeTruthy();

    const paraEl = editor.view.dom.querySelector('p') as HTMLElement;
    const secondHeading = editor.view.dom.querySelectorAll('h2')[1] as HTMLElement;
    expect(paraEl.hasAttribute('hidden')).toBe(false);

    fireEvent.click(collapseBtn);
    expect(paraEl.hasAttribute('hidden')).toBe(true);
    // the second heading B is NOT hidden (equal level stops the collapse).
    expect(secondHeading.hasAttribute('hidden')).toBe(false);

    // After collapse the button flips to "expand".
    const expandBtn = screen.getByLabelText('editor.heading.expand');
    fireEvent.click(expandBtn);
    expect(paraEl.hasAttribute('hidden')).toBe(false);
  });
});

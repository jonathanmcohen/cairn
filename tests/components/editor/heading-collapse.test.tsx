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

// v0.10.0 E3 — chevrons are persistent (one per visible h1/h2/h3; CSS drives
// the reveal), so label queries can match several buttons. Buttons render in
// doc order, so [0] is the FIRST heading's chevron.
function firstCollapseBtn(): HTMLElement {
  return screen.getAllByLabelText('editor.heading.collapse')[0] as HTMLElement;
}

// The collapse state is owned by ProseMirror (#117): toggling dispatches a
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
  it('toggles the section via the heading chevron', () => {
    render(<HeadingCollapse editor={editor} />);

    expect(paragraph().hasAttribute('hidden')).toBe(false);
    expect(paragraph().hasAttribute('data-cairn-collapsed')).toBe(false);

    // Collapse: the following paragraph is hidden via PM decorations, and the
    // collapse STICKS (PM owns the state, so a redraw can't wipe it).
    fireEvent.click(firstCollapseBtn());
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
    fireEvent.click(firstCollapseBtn());
    expect(paragraph().hasAttribute('hidden')).toBe(true);

    // Force a doc transaction (the kind of redraw that previously wiped the raw
    // DOM attributes). The decoration is re-derived from plugin state, so the
    // paragraph stays hidden and its position is remapped through the edit.
    editor.commands.insertContentAt(editor.state.doc.content.size, ' more');
    expect(paragraph().hasAttribute('hidden')).toBe(true);
    expect(paragraph().hasAttribute('data-cairn-collapsed')).toBe(true);
  });

  // v0.9.19 A1 — the v0.9.18 live miss. The chevron computed the heading
  // position as `$pos.before(1)` (the TOP-LEVEL ancestor) and the decoration
  // builder walked only top-level children, so a heading nested inside any
  // `block+` wrapper (column, toggle, callout) toggled a position the builder
  // skipped: the glyph flipped, nothing collapsed. Real pages nest headings;
  // the v0.9.18 harness doc was flat, which is how this passed the gate.
  it('collapses a heading nested inside a column (the v0.9.18 live miss)', () => {
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'columnList',
          content: [
            {
              type: 'column',
              content: [
                {
                  type: 'heading',
                  attrs: { level: 2 },
                  content: [{ type: 'text', text: 'Nested' }],
                },
                { type: 'paragraph', content: [{ type: 'text', text: 'nested body one' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'nested body two' }] },
              ],
            },
            {
              type: 'column',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'other column stays' }] },
              ],
            },
          ],
        },
      ],
    });
    render(<HeadingCollapse editor={editor} />);
    fireEvent.click(firstCollapseBtn());

    const byText = (text: string) =>
      Array.from(editor.view.dom.querySelectorAll('p')).find(
        (p) => p.textContent === text,
      ) as HTMLElement;

    // Both following siblings INSIDE the same column are hidden…
    expect(byText('nested body one').hasAttribute('hidden')).toBe(true);
    expect(byText('nested body one').hasAttribute('data-cairn-collapsed')).toBe(true);
    expect(byText('nested body two').hasAttribute('hidden')).toBe(true);
    // …while the sibling column's content is untouched.
    expect(byText('other column stays').hasAttribute('hidden')).toBe(false);

    // Expand restores both.
    fireEvent.click(screen.getByLabelText('editor.heading.expand'));
    expect(byText('nested body one').hasAttribute('hidden')).toBe(false);
    expect(byText('nested body two').hasAttribute('hidden')).toBe(false);
  });

  // v0.10.0 E3 — discoverability. CSS hover/opacity behavior is e2e territory
  // (tests/e2e/item-E3-chevron-discoverability.spec.ts); here we assert the
  // JS-observable contract the CSS hangs off: persistent buttons + the
  // data-row-hovered / data-collapsed hooks.
  describe('E3 — chevron discoverability hooks', () => {
    it('renders a persistent chevron for every visible collapsible heading (no hover needed)', () => {
      render(<HeadingCollapse editor={editor} />);
      // Both h2 headings have a chevron without any mouse interaction (the old
      // overlay mounted ONE button only while a heading was hovered).
      expect(screen.getAllByLabelText('editor.heading.collapse')).toHaveLength(2);
    });

    it('sets data-row-hovered on the hovered heading chevron only, and clears it off-row', () => {
      render(<HeadingCollapse editor={editor} />);
      const [first, second] = screen.getAllByLabelText('editor.heading.collapse');

      hoverFirstHeading();
      expect(first?.hasAttribute('data-row-hovered')).toBe(true);
      expect(second?.hasAttribute('data-row-hovered')).toBe(false);

      // Mousemove on the editor root far from the heading row + gutter band
      // (jsdom rects are all 0, so coordinates well outside the band).
      fireEvent.mouseMove(editor.view.dom, { clientX: 500, clientY: 500 });
      expect(first?.hasAttribute('data-row-hovered')).toBe(false);
    });

    it('marks a collapsed heading chevron with data-collapsed (CSS keeps it visible without hover)', () => {
      render(<HeadingCollapse editor={editor} />);
      const first = firstCollapseBtn();
      expect(first.hasAttribute('data-collapsed')).toBe(false);

      fireEvent.click(first);
      const expandBtn = screen.getByLabelText('editor.heading.expand');
      expect(expandBtn.hasAttribute('data-collapsed')).toBe(true);
      expect(expandBtn.getAttribute('aria-expanded')).toBe('false');
      // The sibling (uncollapsed) heading chevron stays unmarked.
      const stillExpanded = screen.getByLabelText('editor.heading.collapse');
      expect(stillExpanded.hasAttribute('data-collapsed')).toBe(false);
    });

    it('drops chevrons for headings hidden inside a collapsed section', () => {
      editor.commands.setContent({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Outer' }] },
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Inner' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'deep body' }] },
        ],
      });
      render(<HeadingCollapse editor={editor} />);
      // h2 + h3 both get chevrons while everything is visible.
      expect(screen.getAllByLabelText('editor.heading.collapse')).toHaveLength(2);

      // Collapse the h2: the h3 is hidden with the section, so its chevron has
      // no visible row to anchor to and must disappear from the overlay.
      fireEvent.click(firstCollapseBtn());
      expect(screen.getByLabelText('editor.heading.expand')).toBeTruthy();
      expect(screen.queryAllByLabelText('editor.heading.collapse')).toHaveLength(0);
    });
  });
});

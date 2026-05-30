// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DragHandle } from '@/components/editor/drag-handle';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

afterEach(cleanup);

// Minimal editor mock: enough surface for DragHandle's hover effect + render.
function makeEditorMock() {
  const dom = document.createElement('div');
  // A real block element so the component's `.closest('p, …')` hover match hits.
  const p = document.createElement('p');
  dom.appendChild(p);
  // jsdom has no layout; stub the geometry the effect reads.
  dom.getBoundingClientRect = () => ({ top: 0, left: 0, height: 100 }) as DOMRect;
  p.getBoundingClientRect = () => ({ top: 10, left: 0, height: 20 }) as DOMRect;
  const paragraph = { type: { name: 'paragraph' } };
  const resolved = { after: () => 4, before: () => 0 };
  return {
    chain: () => {
      const chain: Record<string, unknown> = {};
      chain.focus = () => chain;
      chain.command = (fn: (a: { tr: { insert: () => void } }) => boolean) => {
        fn({ tr: { insert: () => {} } });
        return chain;
      };
      chain.setTextSelection = () => chain;
      chain.run = vi.fn();
      return chain;
    },
    state: {
      doc: { resolve: () => resolved, nodeAt: () => paragraph },
      schema: { nodes: { paragraph: { createAndFill: () => paragraph } } },
    },
    view: { dom, posAtDOM: () => 1 },
  } as unknown as Editor;
}

describe('DragHandle + insert button (#96)', () => {
  it('renders an accessible "+" insert button alongside the drag handle', () => {
    const editor = makeEditorMock();
    render(
      <I18nProvider locale="en" messages={enMessages as never}>
        <DragHandle editor={editor} />
      </I18nProvider>,
    );
    // The handle only renders once a block is hovered; simulate a mousemove
    // over a real block element so `pos` becomes non-null.
    const block = editor.view.dom.querySelector('p') as HTMLElement;
    // Dispatch on the block so it bubbles to the editor root's listener with
    // `e.target` === the <p> (which matches the component's `.closest()` query).
    fireEvent.mouseMove(block);
    // After hover, both buttons exist (labels come from the i18n catalog):
    expect(screen.queryByRole('button', { name: /insert block below/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /block actions/i })).toBeTruthy();
  });
});

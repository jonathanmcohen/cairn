// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockContextMenu } from '@/components/editor/block-context-menu';

vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

let editor: Editor;
let host: HTMLDivElement;
const writeText = vi.fn();

beforeAll(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://cairn.test' },
  });
});

beforeEach(async () => {
  writeText.mockClear();
  const { baseExtensions } = await import('@/components/editor/extensions');
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: baseExtensions({ undoRedo: true }),
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
      ],
    },
  });
});

afterEach(() => {
  cleanup();
  editor.destroy();
  host.remove();
});

function paragraphTexts() {
  return editor.state.doc.content.content.map((n) => n.textContent);
}

describe('<BlockContextMenu> (#271)', () => {
  it('opens with the expected items on right-click', async () => {
    render(
      <BlockContextMenu editor={editor} targetPos={6} pageId="p1">
        <div data-testid="block">two</div>
      </BlockContextMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('block'));
    for (const name of [
      'editor.block.duplicate',
      'editor.block.delete',
      'editor.block.comment',
      'editor.block.convert',
      'editor.block.color',
      'editor.block.moveUp',
      'editor.block.copyLink',
    ]) {
      expect(await screen.findByText(name)).toBeTruthy();
    }
  });

  it('Duplicate duplicates the target block', async () => {
    render(
      <BlockContextMenu editor={editor} targetPos={6} pageId="p1">
        <div data-testid="block">two</div>
      </BlockContextMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('block'));
    fireEvent.click(await screen.findByText('editor.block.duplicate'));
    expect(paragraphTexts()).toEqual(['one', 'two', 'two']);
  });

  it('Copy link writes a page anchor to the clipboard', async () => {
    render(
      <BlockContextMenu editor={editor} targetPos={6} pageId="p1">
        <div data-testid="block">two</div>
      </BlockContextMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('block'));
    fireEvent.click(await screen.findByText('editor.block.copyLink'));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0]?.[0])).toContain('/pages/p1#');
  });
});

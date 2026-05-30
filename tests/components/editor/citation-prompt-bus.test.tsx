// @vitest-environment jsdom
import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEditorDialogBus, subscribeEditorDialog } from '@/components/editor/editor-dialog-bus';
import { citationMenuItem } from '@/components/editor/slash-extension';

afterEach(() => resetEditorDialogBus());

describe('citation slash entry routes through the bus', () => {
  it('dispatches a citation request and inserts on submit', async () => {
    const kinds: string[] = [];
    subscribeEditorDialog((req) => {
      kinds.push(req.kind);
      req.resolve({
        author: 'Doe, J.',
        title: 'A Study',
        year: '2020',
        doi: '10.1/x',
        pubmed: '',
      });
    });
    const insertContent = vi.fn(() => ({ run: () => true }));
    const editor = {
      isDestroyed: false,
      extensionManager: { extensions: [] as { name: string }[] },
      setOptions: vi.fn(),
      chain: () => ({ focus: () => ({ insertContent }) }),
    } as unknown as Editor;

    citationMenuItem.run(editor);
    // allow the dynamic imports inside the entry to settle
    await new Promise((r) => setTimeout(r, 50));
    expect(kinds).toEqual(['citation']);
    expect(insertContent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'citation',
        attrs: expect.objectContaining({ raw_title: 'A Study', raw_year: 2020, doi: '10.1/x' }),
      }),
    );
  });

  it('inserts nothing when cancelled', async () => {
    subscribeEditorDialog((req) => req.resolve(null));
    const insertContent = vi.fn(() => ({ run: () => true }));
    const editor = {
      isDestroyed: false,
      extensionManager: { extensions: [] },
      setOptions: vi.fn(),
      chain: () => ({ focus: () => ({ insertContent }) }),
    } as unknown as Editor;
    citationMenuItem.run(editor);
    await new Promise((r) => setTimeout(r, 50));
    expect(insertContent).not.toHaveBeenCalled();
  });
});

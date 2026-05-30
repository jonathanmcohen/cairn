// @vitest-environment jsdom
import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEditorDialogBus, subscribeEditorDialog } from '@/components/editor/editor-dialog-bus';
import { footnoteMenuItem } from '@/components/editor/slash-extension';

afterEach(() => resetEditorDialogBus());

function stubEditor(): Editor {
  const chain = {
    focus: () => chain,
    setMark: () => chain,
    run: () => true,
  };
  return {
    isDestroyed: false,
    extensionManager: { extensions: [] as { name: string }[] },
    setOptions: vi.fn(),
    chain: () => chain,
  } as unknown as Editor;
}

describe('slash prompts route through the editor dialog bus', () => {
  it('footnote dispatches a footnote request and sets the mark on submit', async () => {
    const kinds: string[] = [];
    subscribeEditorDialog((req) => {
      kinds.push(req.kind);
      req.resolve({ text: 'my note' });
    });
    const editor = stubEditor();
    const setMark = vi.fn(() => ({ run: () => true }));
    const chain = { focus: () => ({ setMark }) };
    (editor as unknown as { chain: () => typeof chain }).chain = () => chain;
    footnoteMenuItem.run(editor);
    await new Promise((r) => setTimeout(r, 0));
    expect(kinds).toEqual(['footnote']);
    expect(setMark).toHaveBeenCalledWith(
      'footnote',
      expect.objectContaining({ content: 'my note' }),
    );
  });

  it('footnote does nothing when the dialog is cancelled', async () => {
    subscribeEditorDialog((req) => req.resolve(null));
    const editor = stubEditor();
    const setMark = vi.fn(() => ({ run: () => true }));
    (editor as unknown as { chain: () => unknown }).chain = () => ({
      focus: () => ({ setMark }),
    });
    footnoteMenuItem.run(editor);
    await new Promise((r) => setTimeout(r, 0));
    expect(setMark).not.toHaveBeenCalled();
  });
});

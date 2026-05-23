// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';
import { blockRange, deleteBlocks, selectBlockRange } from '@/components/editor/multi-select';

function makeEditor() {
  return new Editor({
    extensions: baseExtensions(),
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'three' }] },
      ],
    },
  });
}

describe('blockRange', () => {
  it('returns the from/to doc positions spanning whole top-level blocks by index', () => {
    const editor = makeEditor();
    const range = blockRange(editor, 0, 1); // first two paragraphs
    expect(range).not.toBeNull();
    expect(range && range.from).toBe(0);
    // to is the end position of the second block
    expect(range && range.to).toBeGreaterThan(range!.from);
    editor.destroy();
  });
});

describe('selectBlockRange + deleteBlocks', () => {
  it('selects a block range and bulk-deletes it', () => {
    const editor = makeEditor();
    selectBlockRange(editor, 0, 1); // select first two paragraphs
    const ok = deleteBlocks(editor);
    expect(ok).toBe(true);
    const json = editor.getJSON();
    expect(json.content).toHaveLength(1);
    const inline = json.content?.[0]?.content?.[0] as { text?: string } | undefined;
    expect(inline?.text).toBe('three');
    editor.destroy();
  });

  it('deleteBlocks is a no-op (returns false) on an empty/collapsed selection across no whole blocks', () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(2); // collapsed cursor in block 0
    const ok = deleteBlocks(editor);
    // collapsed cursor is not a multi-block range → deleteBlocks declines
    expect(ok).toBe(false);
    expect(editor.getJSON().content).toHaveLength(3);
    editor.destroy();
  });
});

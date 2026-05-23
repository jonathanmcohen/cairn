// @vitest-environment jsdom
import { type Content, Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { CONVERTIBLE, canConvert, turnInto } from '@/components/editor/block-convert';
import { baseExtensions } from '@/components/editor/extensions';

function makeEditor(content: Content) {
  return new Editor({ extensions: baseExtensions(), content });
}

describe('CONVERTIBLE map', () => {
  it('lists paragraph ↔ heading ↔ bulletList/orderedList/taskList/blockquote/codeBlock as targets', () => {
    expect(CONVERTIBLE.paragraph).toContain('heading');
    expect(CONVERTIBLE.paragraph).toContain('bulletList');
    expect(CONVERTIBLE.heading).toContain('paragraph');
    expect(canConvert('paragraph', 'heading')).toBe(true);
    expect(canConvert('paragraph', 'image')).toBe(false); // not a text block target
  });
});

describe('turnInto', () => {
  it('converts a paragraph to a heading (level carried in attrs)', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    });
    // place cursor inside the paragraph
    editor.commands.setTextSelection(2);
    const ok = turnInto(editor, 'heading', { level: 2 });
    expect(ok).toBe(true);
    const json = editor.getJSON();
    expect(json.content?.[0]?.type).toBe('heading');
    expect(json.content?.[0]?.attrs?.level).toBe(2);
    const inline = json.content?.[0]?.content?.[0] as { text?: string } | undefined;
    expect(inline?.text).toBe('hello');
    editor.destroy();
  });

  it('converts a paragraph to a bullet list (wrap), preserving the text', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }],
    });
    editor.commands.setTextSelection(2);
    const ok = turnInto(editor, 'bulletList');
    expect(ok).toBe(true);
    const json = editor.getJSON();
    expect(json.content?.[0]?.type).toBe('bulletList');
    editor.destroy();
  });

  it('returns false for an incompatible target without mutating the doc', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
    });
    editor.commands.setTextSelection(2);
    const before = editor.getJSON();
    const ok = turnInto(editor, 'image');
    expect(ok).toBe(false);
    expect(editor.getJSON()).toEqual(before);
    editor.destroy();
  });
});

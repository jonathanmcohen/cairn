// @vitest-environment jsdom
// v0.10.0 E4 — suggest-mode auto-mark-on-type: transaction-rewrite logic.
//
// The SuggestionAutoMark extension rewrites editor transactions while suggest
// mode is ON: typed text gains suggestionInsert, deletions become
// suggestionDelete tombstones (text kept, cursor moved as if deleted), and
// deleting your OWN pending insert (active suggestion id) really removes it.
// Marks must be SHAPE-IDENTICAL to the manual markSelection attrs
// ({ suggestionId, authorId, createdAt }) so the shared accept/reject
// transform (src/lib/suggestions/transform.ts) needs no second code path.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { SuggestionDelete } from '@/components/editor/marks/suggestion-delete';
import { SuggestionInsert } from '@/components/editor/marks/suggestion-insert';
import {
  SuggestionAutoMark,
  type SuggestionAutoMarkStorage,
  suggestionAutoMarkPluginKey,
} from '@/components/editor/suggestion-auto-mark';

// Track + destroy editors so prosemirror-view's DOMObserver doesn't schedule a
// deferred flush that fires after vitest tears down jsdom (same fix as
// footnote-mark.test.ts / audio-node.test.tsx).
const editors: Editor[] = [];

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
});

const SUGGESTION_ID = 'sugg-e4-test';
const AUTHOR_ID = 'user-e4';

function makeEditor(text = 'hello world') {
  const editor = new Editor({
    extensions: [StarterKit, SuggestionInsert, SuggestionDelete, SuggestionAutoMark],
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
  });
  editors.push(editor);
  return editor;
}

function storageOf(editor: Editor): SuggestionAutoMarkStorage {
  const storage = (editor.storage as { suggestionAutoMark?: SuggestionAutoMarkStorage })
    .suggestionAutoMark;
  if (!storage) throw new Error('suggestionAutoMark storage missing');
  return storage;
}

function enableMode(editor: Editor) {
  const s = storageOf(editor);
  s.active = true;
  s.suggestionId = SUGGESTION_ID;
  s.authorId = AUTHOR_ID;
}

type InlineJson = {
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

/** Flatten the first paragraph into [text, markTypes[], attrs[]] tuples. */
function inlineOf(editor: Editor) {
  const para = editor.getJSON().content?.[0];
  return ((para?.content ?? []) as InlineJson[]).map((n) => ({
    text: n.text,
    marks: (n.marks ?? []).map((m) => m.type),
    attrs: (n.marks ?? []).map((m) => m.attrs),
  }));
}

describe('SuggestionAutoMark — insert auto-marking', () => {
  it('marks typed text with suggestionInsert carrying the active id (markSelection attrs shape)', () => {
    const editor = makeEditor();
    enableMode(editor);
    // "hello world" spans [1, 12]; type at the end.
    editor.view.dispatch(editor.state.tr.insertText('XYZ', 12));

    const inline = inlineOf(editor);
    expect(inline).toHaveLength(2);
    expect(inline[0]).toMatchObject({ text: 'hello world', marks: [] });
    expect(inline[1]?.text).toBe('XYZ');
    expect(inline[1]?.marks).toEqual(['suggestionInsert']);
    // EXACT attrs shape parity with editor.tsx markSelection():
    // { suggestionId, authorId, createdAt: ISO string } — nothing more.
    const attrs = inline[1]?.attrs[0] as Record<string, unknown>;
    expect(Object.keys(attrs).sort()).toEqual(['authorId', 'createdAt', 'suggestionId']);
    expect(attrs.suggestionId).toBe(SUGGESTION_ID);
    expect(attrs.authorId).toBe(AUTHOR_ID);
    expect(typeof attrs.createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(attrs.createdAt as string))).toBe(false);
  });

  it('keeps consecutive keystrokes as ONE merged text node (stable attrs)', () => {
    const editor = makeEditor();
    enableMode(editor);
    editor.view.dispatch(editor.state.tr.insertText('X', 12));
    editor.view.dispatch(editor.state.tr.insertText('Y', 13));
    editor.view.dispatch(editor.state.tr.insertText('Z', 14));

    const inline = inlineOf(editor);
    // If each keystroke minted a fresh createdAt, the marks would be unequal
    // and ProseMirror could never join the nodes → per-character fragments.
    expect(inline).toHaveLength(2);
    expect(inline[1]?.text).toBe('XYZ');
  });

  it('mode off → plain insert and plain delete (no marks, text really removed)', () => {
    const editor = makeEditor();
    // storage stays at its inactive defaults
    editor.view.dispatch(editor.state.tr.insertText('XYZ', 12));
    editor.view.dispatch(editor.state.tr.delete(1, 6));

    const inline = inlineOf(editor);
    expect(inline).toHaveLength(1);
    expect(inline[0]).toMatchObject({ text: ' worldXYZ', marks: [] });
  });
});

describe('SuggestionAutoMark — deletions become tombstones', () => {
  it('Backspace over plain text keeps the text, adds suggestionDelete, moves the cursor before it', () => {
    const editor = makeEditor();
    enableMode(editor);
    // Caret after the final 'd' (pos 12), Backspace deletes [11, 12].
    editor.commands.setTextSelection(12);
    editor.view.dispatch(editor.state.tr.delete(11, 12));

    const inline = inlineOf(editor);
    expect(inline.map((n) => n.text).join('')).toBe('hello world'); // nothing lost
    expect(inline[1]?.text).toBe('d');
    expect(inline[1]?.marks).toEqual(['suggestionDelete']);
    expect(inline[1]?.attrs[0]).toMatchObject({
      suggestionId: SUGGESTION_ID,
      authorId: AUTHOR_ID,
    });
    // Cursor sits BEFORE the tombstone — repeated Backspace strikes leftward.
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(11);
  });

  it('forward Delete tombstones and moves the cursor AFTER it (no re-delete loop)', () => {
    const editor = makeEditor();
    enableMode(editor);
    // Caret before 'h' (pos 1), forward Delete removes [1, 2].
    editor.commands.setTextSelection(1);
    editor.view.dispatch(editor.state.tr.delete(1, 2));

    const inline = inlineOf(editor);
    expect(inline.map((n) => n.text).join('')).toBe('hello world');
    expect(inline[0]?.text).toBe('h');
    expect(inline[0]?.marks).toEqual(['suggestionDelete']);
    // Cursor lands after the struck 'h' so the next Delete hits 'e'.
    expect(editor.state.selection.from).toBe(2);
  });

  it('typing over a selection → tombstone of the old text + marked insert after it', () => {
    const editor = makeEditor();
    enableMode(editor);
    // Replace 'hello' [1, 6] with 'Bye' in one ReplaceStep (cut+type path).
    editor.view.dispatch(editor.state.tr.insertText('Bye', 1, 6));

    const inline = inlineOf(editor);
    expect(inline.map((n) => n.text).join('')).toBe('helloBye world');
    expect(inline[0]?.text).toBe('hello');
    expect(inline[0]?.marks).toEqual(['suggestionDelete']);
    expect(inline[1]?.text).toBe('Bye');
    expect(inline[1]?.marks).toEqual(['suggestionInsert']);
    expect(inline[2]).toMatchObject({ text: ' world', marks: [] });
  });

  it('deleting your OWN pending insert really removes it (undo of an unaccepted insert)', () => {
    // PINNED DECISION: same-open-suggestion inserts are REMOVED on delete
    // (Google Docs behavior), not tombstoned. Other ids → tombstoned (below).
    const editor = makeEditor();
    enableMode(editor);
    editor.view.dispatch(editor.state.tr.insertText('XYZ', 12)); // auto-marked insert
    expect(inlineOf(editor)).toHaveLength(2);

    editor.commands.setTextSelection(15);
    editor.view.dispatch(editor.state.tr.delete(12, 15)); // delete own pending insert

    const inline = inlineOf(editor);
    expect(inline).toHaveLength(1);
    expect(inline[0]).toMatchObject({ text: 'hello world', marks: [] });
  });

  it("deleting ANOTHER suggestion's insert tombstones it instead of removing it", () => {
    const editor = makeEditor();
    enableMode(editor);
    // Plant an insert mark from a DIFFERENT (e.g. already-closed) suggestion.
    const insertType = editor.schema.marks.suggestionInsert;
    if (!insertType) throw new Error('suggestionInsert missing from schema');
    const tr = editor.state.tr.insertText('OLD', 12);
    tr.addMark(
      12,
      15,
      insertType.create({
        suggestionId: 'someone-elses-suggestion',
        authorId: 'other-user',
        createdAt: new Date(0).toISOString(),
      }),
    );
    tr.setMeta('preventUpdate', true); // setup write, not user input — skip the rewrite
    editor.view.dispatch(tr);

    editor.commands.setTextSelection(15);
    editor.view.dispatch(editor.state.tr.delete(12, 15));

    const inline = inlineOf(editor);
    const old = inline.find((n) => n.text === 'OLD');
    expect(old).toBeDefined();
    expect(old?.marks).toContain('suggestionDelete');
  });

  it('text already tombstoned keeps its ORIGINAL suggestionDelete mark when re-deleted', () => {
    const editor = makeEditor();
    enableMode(editor);
    // First pass: tombstone 'd' under the active suggestion.
    editor.commands.setTextSelection(12);
    editor.view.dispatch(editor.state.tr.delete(11, 12));
    const before = inlineOf(editor).find((n) => n.text === 'd');
    expect(before?.marks).toEqual(['suggestionDelete']);

    // Second pass: Backspace over the tombstone again — restored, not doubled.
    editor.commands.setTextSelection(12);
    editor.view.dispatch(editor.state.tr.delete(11, 12));
    const after = inlineOf(editor).find((n) => n.text === 'd');
    expect(after?.marks).toEqual(['suggestionDelete']);
    expect(after?.attrs[0]).toMatchObject({ suggestionId: SUGGESTION_ID });
    expect(
      inlineOf(editor)
        .map((n) => n.text)
        .join(''),
    ).toBe('hello world');
  });

  it('skips transactions marked preventUpdate (the resolve()/setContent mirror path)', () => {
    const editor = makeEditor();
    enableMode(editor);
    const tr = editor.state.tr.delete(1, 6);
    tr.setMeta('preventUpdate', true);
    editor.view.dispatch(tr);
    // The accept-mirror's deletion must NOT be resurrected as a tombstone.
    expect(inlineOf(editor)).toEqual([{ text: ' world', marks: [], attrs: [] }]);
  });
});

describe('SuggestionAutoMark — IME composition guard', () => {
  it('does not mark per keystroke while composing; marks ONCE on commit', () => {
    const editor = makeEditor();
    enableMode(editor);

    let composing = true;
    Object.defineProperty(editor.view, 'composing', {
      get: () => composing,
      configurable: true,
    });

    // Two composition updates — the plugin must stay hands-off.
    editor.view.dispatch(editor.state.tr.insertText('ne', 12));
    expect(inlineOf(editor)).toHaveLength(1); // still one unmarked text node
    editor.view.dispatch(editor.state.tr.insertText('ko', 14));
    expect(inlineOf(editor)).toHaveLength(1);
    expect(suggestionAutoMarkPluginKey.getState(editor.state)?.pending).toHaveLength(1);

    // Commit: composition ends; the compositionend poke is a meta-only tr.
    composing = false;
    editor.view.dispatch(editor.state.tr.setMeta(suggestionAutoMarkPluginKey, { type: 'flush' }));

    const inline = inlineOf(editor);
    expect(inline).toHaveLength(2);
    expect(inline[1]?.text).toBe('neko'); // ONE span for the committed token
    expect(inline[1]?.marks).toEqual(['suggestionInsert']);
    expect(inline[1]?.attrs[0]).toMatchObject({ suggestionId: SUGGESTION_ID });
    expect(suggestionAutoMarkPluginKey.getState(editor.state)?.pending).toHaveLength(0);
  });
});

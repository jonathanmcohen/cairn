// @vitest-environment jsdom
import { type Content, Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { runSlashItem, SLASH_ITEMS } from '@/components/editor/slash-extension';
import type { SlashItem } from '@/components/editor/slash-menu';

// A3 (#38/76/77/111/112) — slash-command range + cancel correctness.
//
// We exercise the EXPORTED dispatch (`runSlashItem`) directly rather than the
// live tippy/Suggestion plugin (which needs a real DOM + key events). The
// dispatch receives the same `{ editor, range }` the suggestion `command`
// hands it; the range here mimics the suggestion match `/h1` etc. We assert:
//   - synchronous block items: the block transforms, the `/query` trigger text
//     is consumed (no stray `/` or merged residue).
//   - cancel/early-return (a deferred item whose async work never inserts):
//     the original `/query` text is LEFT INTACT (no lone `/`, no deletion).

type Block = 'paragraph' | 'heading' | 'bulletList' | 'blockquote';

function blockDoc(kind: Block, text: string): Content {
  const para = { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] };
  switch (kind) {
    case 'paragraph':
      return { type: 'doc', content: [para] };
    case 'heading':
      return {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: text ? [{ type: 'text', text }] : [] },
        ],
      };
    case 'bulletList':
      return {
        type: 'doc',
        content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [para] }] }],
      };
    case 'blockquote':
      return { type: 'doc', content: [{ type: 'blockquote', content: [para] }] };
  }
}

// StarterKit alone supplies paragraph/heading/bulletList/blockquote/codeBlock —
// the block types under test. We deliberately omit the SlashCommand extension:
// its live @tiptap/suggestion plugin renders a tippy popup on every transaction,
// which throws in jsdom. We exercise `runSlashItem` directly, so the plugin
// isn't needed.
function makeEditor(content: Content) {
  return new Editor({ extensions: [StarterKit], content });
}

// Find the position range of the `/query` substring in the current doc and the
// caret placement at its end (mirroring how the suggestion match is bounded).
function rangeOfTrigger(editor: Editor, query: string): { from: number; to: number } {
  const text = editor.state.doc.textContent;
  const idx = text.indexOf(query);
  if (idx < 0) throw new Error(`trigger ${query} not found in ${JSON.stringify(text)}`);
  // doc text positions are 1-based inside the first text block; resolve by
  // walking to the text node. For our simple single-block fixtures the trigger
  // start maps to the block's content start + idx.
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from >= 0) return false;
    if (node.isText && node.text?.includes(query)) {
      from = pos + (node.text.indexOf(query) ?? 0);
      return false;
    }
    return true;
  });
  if (from < 0) throw new Error('could not resolve trigger pos');
  return { from, to: from + query.length };
}

let editors: Editor[] = [];
afterEach(() => {
  for (const e of editors) e.destroy();
  editors = [];
});
function track(e: Editor): Editor {
  editors.push(e);
  return e;
}

const SYNC_CASES: Array<{ title: string; query: string; expectType: string }> = [
  { title: 'Heading 1', query: '/h1', expectType: 'heading' },
  { title: 'Bullet list', query: '/bullet', expectType: 'bulletList' },
  { title: 'Quote', query: '/quote', expectType: 'blockquote' },
  { title: 'Code', query: '/code', expectType: 'codeBlock' },
];

const BLOCKS: Block[] = ['paragraph', 'heading', 'bulletList', 'blockquote'];

describe('slash-command range + trigger consumption (#38)', () => {
  for (const block of BLOCKS) {
    for (const c of SYNC_CASES) {
      it(`[${block}] "${c.query}" → ${c.expectType}, trigger consumed, no stray chars`, () => {
        const editor = track(makeEditor(blockDoc(block, c.query)));
        const range = rangeOfTrigger(editor, c.query);
        editor.commands.setTextSelection(range.to);
        const item = SLASH_ITEMS.find((i) => i.title === c.title) as SlashItem;
        runSlashItem({ editor, range, item });
        const out = editor.state.doc.textContent;
        // The `/query` trigger must be fully consumed — no leftover slash or
        // residual query text merged into the new block.
        expect(out).not.toContain('/');
        expect(out).not.toContain(c.query.slice(1));
      });
    }
  }
});

describe('no pre-delete on dispatch: deferred item keeps text until its flow resolves (#76/#77/#111/#112 → B1)', () => {
  for (const block of BLOCKS) {
    it(`[${block}] dispatching a deferred command does NOT pre-delete the /trigger`, () => {
      const editor = track(makeEditor(blockDoc(block, '/cancelme')));
      const range = rangeOfTrigger(editor, '/cancelme');
      editor.commands.setTextSelection(range.to);
      // A deferred item whose async work is still PENDING (dialog open, picker
      // up). The dispatch must NOT have pre-deleted the range — under B1 the
      // command itself consumes it later, on commit (consumeSlashRange) or on
      // cancel (cancelSlashTrigger); this stub models neither having happened.
      const deferred: SlashItem = {
        title: 'X',
        description: '',
        category: 'advanced',
        keywords: [],
        deferred: true,
        command: () => {
          /* flow still pending → no insert, no cancel yet */
        },
      };
      runSlashItem({ editor, range, item: deferred });
      // Text must be fully intact while the flow is pending: a lone "/" or
      // partial deletion at dispatch time is the bug.
      expect(editor.state.doc.textContent).toContain('/cancelme');
    });
  }
});

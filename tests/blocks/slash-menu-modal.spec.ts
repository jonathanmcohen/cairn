/**
 * Plan B4/B5 (#76/#128/#136) — slash items that open modals consume range +
 * destroy popup. Regression; mechanism shipped v0.9.13.
 *
 * Mechanism (confirmed in slash-extension.ts):
 *  - Every modal/picker/lazy slash item is `deferred: true`. `runSlashItem`
 *    does NOT pre-delete the trigger range for deferred items — it hands the
 *    range to the command, which calls `consumeSlashRange` only on a real
 *    commit. So a cancel leaves the typed `/query` text intact (no lone `/`).
 *  - The Suggestion `render().onExit` destroys the tippy popup the moment an
 *    item is dispatched, before any modal paints (#128/#136).
 * See docs/superpowers/plans/v0.9.14/plan-B-editor-block-fixes.md.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as bus from '@/components/editor/editor-dialog-bus';
import {
  consumeSlashRange,
  runSlashItem,
  SLASH_ITEMS,
  slashTriggerRange,
} from '@/components/editor/slash-extension';

vi.mock('@/components/editor/extensions-lazy', () => ({
  loadEditorExtension: vi.fn(async () => ({ name: 'stub' })),
}));

const SLASH_SRC = readFileSync(
  new URL('../../src/components/editor/slash-extension.ts', import.meta.url),
  'utf8',
);

function makeChain() {
  const deleteRange = vi.fn().mockReturnThis();
  const chain: Record<string, unknown> = new Proxy(
    { deleteRange, run: vi.fn(), focus: () => chain },
    {
      get(t, p) {
        return p in t ? t[p as keyof typeof t] : () => chain;
      },
    },
  );
  return { chain, deleteRange };
}

function makeEditor(extensions: { name: string }[] = []) {
  const { chain, deleteRange } = makeChain();
  return {
    isDestroyed: false,
    extensionManager: { extensions },
    chain: () => chain,
    setOptions: vi.fn(),
    state: { doc: { textBetween: () => '' } },
    _deleteRange: deleteRange,
  };
}

// All modal-spawning items are deferred so `runSlashItem` never pre-deletes
// the trigger range itself — each command owns range consumption.
const MODAL_ITEMS = ['Equation', 'Citation', 'Footnote', 'Flashcard'];
// Of those, Equation and Flashcard gate `consumeSlashRange` behind the dialog
// resolving to a real insert, so cancelling leaves the typed text intact (#76).
const COMMIT_ONLY_CONSUME_ITEMS = ['Equation', 'Flashcard'];

describe('Plan B4/B5 — slash modal consistency (regression)', () => {
  it('every modal-spawning slash item is deferred:true', () => {
    for (const title of MODAL_ITEMS) {
      const item = SLASH_ITEMS.find((i) => i.title === title);
      expect(item, `${title} missing`).toBeDefined();
      expect(item?.deferred, `${title} must be deferred`).toBe(true);
    }
  });

  it('runSlashItem never pre-deletes the range for deferred items (the command owns consume)', () => {
    // Patch each deferred command with a spy so runSlashItem's branch is the
    // only thing under test — it must hand off without touching deleteRange.
    for (const title of MODAL_ITEMS) {
      const item = SLASH_ITEMS.find((i) => i.title === title);
      if (!item) continue;
      const editor = makeEditor();
      const stub = { ...item, command: vi.fn() };
      runSlashItem({ editor: editor as never, range: { from: 2, to: 2 }, item: stub });
      expect(stub.command, `${title} command should receive the range`).toHaveBeenCalledTimes(1);
      expect(
        editor._deleteRange.mock.calls.length,
        `${title}: runSlashItem must not pre-delete the deferred range`,
      ).toBe(0);
    }
  });

  it('commit-only items (Equation/Flashcard) do not consume the range when the dialog is cancelled', () => {
    for (const title of COMMIT_ONLY_CONSUME_ITEMS) {
      const item = SLASH_ITEMS.find((i) => i.title === title);
      if (!item) continue;
      vi.spyOn(bus, 'openEditorDialog').mockResolvedValue(null);
      const editor = makeEditor();
      runSlashItem({ editor: editor as never, range: { from: 2, to: 2 }, item });
      // Dialog resolved to null (cancel) → no insert → no range consumed, so
      // the typed "/query" is left behind rather than a lone "/".
      expect(
        editor._deleteRange.mock.calls.length,
        `${title} must not consume range on cancel`,
      ).toBe(0);
      vi.restoreAllMocks();
    }
  });

  it('range is consumed (deleteRange) only when a range is provided; no leftover "/" on cancel', () => {
    // No-op on cancel: undefined range must not throw and must not delete.
    const cancelEditor = makeEditor();
    expect(() => consumeSlashRange(cancelEditor as never, undefined)).not.toThrow();
    expect(cancelEditor._deleteRange.mock.calls.length).toBe(0);

    // On commit: the trigger range is deleted so the typed "/query" is removed.
    const { chain, deleteRange } = makeChain();
    const commitEditor = {
      isDestroyed: false,
      extensionManager: { extensions: [] },
      chain: () => chain,
      setOptions: vi.fn(),
    };
    consumeSlashRange(commitEditor as never, { from: 1, to: 3 });
    expect(deleteRange).toHaveBeenCalledWith({ from: 1, to: 3 });
  });

  it('the Suggestion render destroys the popup on exit (before the modal paints)', () => {
    // onExit tears down the floating popup synchronously when an item is
    // dispatched — this is what keeps the slash menu from sitting behind the
    // modal (#128/#136).
    expect(SLASH_SRC).toMatch(/onExit:\s*\(\)\s*=>\s*\{[^}]*popup\.destroy\(\)/);
  });
});

describe('slashTriggerRange (#38) — backstop for deferred consume correctness', () => {
  it('widens range to include the leading / when char before is /', () => {
    const editor = {
      isDestroyed: false,
      extensionManager: { extensions: [] },
      chain: () => ({}),
      setOptions: vi.fn(),
      state: { doc: { textBetween: () => '/' } },
    };
    expect(slashTriggerRange(editor as never, { from: 5, to: 8 })).toEqual({ from: 4, to: 8 });
  });

  it('does not widen range when char before is not /', () => {
    const editor = {
      isDestroyed: false,
      extensionManager: { extensions: [] },
      chain: () => ({}),
      setOptions: vi.fn(),
      state: { doc: { textBetween: () => 'a' } },
    };
    expect(slashTriggerRange(editor as never, { from: 5, to: 8 })).toEqual({ from: 5, to: 8 });
  });
});

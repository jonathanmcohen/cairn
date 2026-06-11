import { Extension } from '@tiptap/core';
import { Fragment, type Node as PMNode, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { ySyncPluginKey } from 'y-prosemirror';

/**
 * v0.10.0 E4 — Google-Docs-style auto-tracking while suggest mode is ON.
 *
 * Suggest mode used to be entirely manual: toggle Suggesting, select a range,
 * click "Mark insert"/"Mark delete". This extension adds automatic tracking on
 * top (the manual buttons stay for marking pre-existing ranges):
 *  - typed/pasted text gets the `suggestionInsert` mark with the active
 *    suggestion id, byte-identical in shape to the manual `markSelection`
 *    attrs (`{ suggestionId, authorId, createdAt }`), so the SHARED
 *    accept/reject path (src/lib/suggestions/transform.ts) works unchanged;
 *  - deletions (Backspace / Delete / cut / typing over a selection) are
 *    REWRITTEN into tombstones: the text stays in the doc, gains the
 *    `suggestionDelete` mark, and the cursor moves as if the delete happened
 *    (before the tombstone for backward deletes, after it for forward
 *    deletes — so repeated Backspace/Delete walks past struck text instead
 *    of looping on it);
 *  - deleting text that is YOUR OWN pending insert (a `suggestionInsert`
 *    carrying the ACTIVE suggestion id) really removes it — you are undoing
 *    your own unaccepted insert (Google Docs behavior). Other authors' /
 *    closed suggestions' text is tombstoned like plain text. (For multi-block
 *    deletions the own-insert text is tombstoned instead of removed — the
 *    documented fallback; the common single-textblock path gets true removal.)
 *
 * Everything happens via `appendTransaction` ON TOP of the regular editor
 * transaction pipeline, so y-prosemirror sees ordinary granular steps and the
 * rewrite replicates over Yjs exactly like hand-typed content. We never touch
 * the Y.Doc directly (see the resolve() comment in editor.tsx for why
 * reconstructing a Y.Doc + Y.applyUpdate can never work for deletions).
 *
 * Transactions are SKIPPED (left untouched) when they:
 *  - carry the y-sync plugin meta (remote peers' changes + Yjs undo/redo
 *    round-trips must never be re-marked locally),
 *  - carry `preventUpdate` (TipTap setContent(..., { emitUpdate: false }) —
 *    the resolve() accept/reject mirror applies a computed doc while suggest
 *    mode may still be on; re-tombstoning its deletions would resurrect the
 *    text the accept just removed),
 *  - are this plugin's own appended rewrites (meta type 'clear').
 *
 * Structural-only edits are deliberately untracked: Enter (block split),
 * Backspace at a block start (block join with no text removed) and
 * ReplaceAroundSteps (wraps/lifts) pass through unchanged. Tracking block
 * topology is out of scope for E4 — only inline content is auto-marked, which
 * matches what the manual Mark buttons could express. Textblocks whose schema
 * disallows the suggestion marks (code blocks) also pass through unchanged.
 *
 * IME/composition: while `view.composing` is true nothing is rewritten —
 * interfering mid-composition breaks IMEs. Inserted ranges are accumulated in
 * plugin state (remapped through every transaction, so preview text that the
 * IME replaces collapses away) and ONE `suggestionInsert` mark is applied per
 * committed token on the first non-composing transaction (a deferred
 * `compositionend` poke guarantees there is one). Deletions that happen while
 * composing (the IME replacing its own preview) are never tombstoned.
 *
 * Mode plumbing: the live on/off + active suggestion id + author arrive via
 * extension storage (`editor.storage.suggestionAutoMark`), written by an
 * editor.tsx effect whenever React's `suggestionMode` state changes — the same
 * channel the `cairn` storage namespace already uses for pageId/encrypted.
 */

export type SuggestionAutoMarkStorage = {
  /** True while suggest mode is ON for an editable surface. */
  active: boolean;
  /** The open suggestion id new auto-marks attach to (set by toggleSuggestion). */
  suggestionId: string | null;
  /** The local user id, stamped into mark attrs like markSelection does. */
  authorId: string | null;
};

type Range = { from: number; to: number };
type PluginState = { pending: Range[] };

type AutoMarkMeta = { type: 'clear' } | { type: 'flush' };

export const suggestionAutoMarkPluginKey = new PluginKey<PluginState>('suggestionAutoMark');

const INSERT = 'suggestionInsert';
const DELETE = 'suggestionDelete';

/** Merge overlapping/adjacent ranges so one composed token gets ONE mark span. */
function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) {
      last.to = Math.max(last.to, r.to);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/** Does the slice carry any inline content (text or inline atoms)? */
function sliceHasInline(slice: Slice): boolean {
  let found = false;
  slice.content.descendants((node) => {
    if (found) return false;
    if (node.isInline) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

/** Map a position forward through the rest of tr `t` (after step `i`) and all later trs. */
function mapForward(
  pos: number,
  assoc: -1 | 1,
  trs: readonly Transaction[],
  t: number,
  i: number,
): number {
  let p = pos;
  const tr = trs[t];
  if (tr) {
    for (let j = i + 1; j < tr.steps.length; j++) {
      p = tr.mapping.maps[j]?.map(p, assoc) ?? p;
    }
  }
  for (let u = t + 1; u < trs.length; u++) {
    const later = trs[u];
    if (later) p = later.mapping.map(p, assoc);
  }
  return p;
}

export const SuggestionAutoMark = Extension.create<
  Record<string, never>,
  SuggestionAutoMarkStorage
>({
  name: 'suggestionAutoMark',

  addStorage() {
    return { active: false, suggestionId: null, authorId: null };
  },

  addProseMirrorPlugins() {
    // biome-ignore lint/complexity/noUselessThisAlias: the plugin callbacks need the live extension storage/editor
    const ext = this;

    // One createdAt per (suggestionId, authorId): per-keystroke timestamps
    // would make adjacent text nodes carry UNEQUAL marks, so ProseMirror could
    // never join them and the doc would fragment into per-character text
    // nodes. Manual markSelection stamps one createdAt per click — one per
    // auto-tracked suggestion session is the same granularity.
    let cachedAttrs: { suggestionId: string; authorId: string | null; createdAt: string } | null =
      null;
    const attrsFor = (storage: SuggestionAutoMarkStorage) => {
      const suggestionId = storage.suggestionId as string;
      if (
        !cachedAttrs ||
        cachedAttrs.suggestionId !== suggestionId ||
        cachedAttrs.authorId !== storage.authorId
      ) {
        cachedAttrs = {
          suggestionId,
          authorId: storage.authorId,
          createdAt: new Date().toISOString(),
        };
      }
      return cachedAttrs;
    };

    const isComposing = (): boolean => {
      try {
        return ext.editor?.view?.composing ?? false;
      } catch {
        return false; // view not mounted yet (placeholder editor)
      }
    };

    const isTracking = (): boolean => Boolean(ext.storage.active && ext.storage.suggestionId);

    /** Transactions this plugin must leave alone (see module docblock). */
    const shouldSkip = (tr: Transaction): boolean => {
      const own = tr.getMeta(suggestionAutoMarkPluginKey) as AutoMarkMeta | undefined;
      if (own && own.type !== 'flush') return true;
      if (tr.getMeta('preventUpdate')) return true;
      if (tr.getMeta(ySyncPluginKey)) return true;
      if (tr.getMeta('addToHistory') === false) return true;
      return false;
    };

    /** Inserted inline ranges of one transaction, in that tr's FINAL doc coords. */
    const insertedRangesOf = (tr: Transaction): Range[] => {
      const out: Range[] = [];
      tr.steps.forEach((step, i) => {
        if (!(step instanceof ReplaceStep) || step.slice.size === 0) return;
        if (!sliceHasInline(step.slice)) return;
        let from = step.from;
        let to = step.from + step.slice.size;
        for (let j = i + 1; j < tr.steps.length; j++) {
          const m = tr.mapping.maps[j];
          if (!m) continue;
          from = m.map(from, 1);
          to = m.map(to, -1);
        }
        if (to > from) out.push({ from, to });
      });
      return out;
    };

    return [
      new Plugin<PluginState>({
        key: suggestionAutoMarkPluginKey,

        state: {
          init: () => ({ pending: [] }),
          apply: (tr, value): PluginState => {
            const meta = tr.getMeta(suggestionAutoMarkPluginKey) as AutoMarkMeta | undefined;
            if (meta?.type === 'clear') return { pending: [] };

            let pending = value.pending;
            if (pending.length > 0 && tr.docChanged) {
              pending = pending
                .map((r) => ({ from: tr.mapping.map(r.from, 1), to: tr.mapping.map(r.to, -1) }))
                .filter((r) => r.to > r.from);
            }
            // While composing, RECORD inserted ranges instead of marking them
            // (appendTransaction stays hands-off until the commit).
            if (isComposing() && isTracking() && tr.docChanged && !shouldSkip(tr)) {
              const added = insertedRangesOf(tr);
              if (added.length > 0) pending = mergeRanges([...pending, ...added]);
            }
            return pending === value.pending ? value : { pending };
          },
        },

        props: {
          handleDOMEvents: {
            // Guarantee a flush transaction right after the IME commits, even
            // if the user stops typing. Deferred so prosemirror-view's own
            // compositionend handling (which may dispatch the final text
            // mutation) runs first.
            compositionend: (view) => {
              setTimeout(() => {
                if (view.isDestroyed) return;
                const state = suggestionAutoMarkPluginKey.getState(view.state);
                if (!state || state.pending.length === 0) return;
                view.dispatch(
                  view.state.tr.setMeta(suggestionAutoMarkPluginKey, {
                    type: 'flush',
                  } satisfies AutoMarkMeta),
                );
              }, 0);
              return false;
            },
          },
        },

        appendTransaction: (transactions, oldState, newState) => {
          const composing = isComposing();
          const pending = suggestionAutoMarkPluginKey.getState(newState)?.pending ?? [];

          if (!isTracking()) {
            // Mode toggled off with composition leftovers: drop them unmarked.
            if (pending.length > 0 && !composing) {
              return newState.tr.setMeta(suggestionAutoMarkPluginKey, {
                type: 'clear',
              } satisfies AutoMarkMeta);
            }
            return null;
          }
          if (composing) return null; // never interfere mid-composition

          const storage = ext.storage;
          const insertType = newState.schema.marks[INSERT];
          const deleteType = newState.schema.marks[DELETE];
          if (!insertType || !deleteType) return null;

          // pending > 0 ⇒ a composition just committed. The deletions in this
          // group (if any) are the IME replacing its own preview text — they
          // must NOT be tombstoned.
          const compositionCommit = pending.length > 0;

          type InsOp = { kind: 'ins'; pos: number; from: number; to: number };
          type DelOp = {
            kind: 'del';
            pos: number;
            slice: Slice;
            dir: 'back' | 'fwd';
            setSel: boolean;
          };
          const ops: Array<InsOp | DelOp> = [];
          let sawSelOwner = false;

          transactions.forEach((tr, t) => {
            if (!tr.docChanged || shouldSkip(tr)) return;
            const selBefore = t === 0 ? oldState.selection : null;

            tr.steps.forEach((step, i) => {
              if (!(step instanceof ReplaceStep)) return; // wraps/lifts etc. are untracked
              const docBefore = tr.docs[i];
              if (!docBefore) return;

              // --- inserted inline content → suggestionInsert -------------
              if (step.slice.size > 0 && sliceHasInline(step.slice)) {
                const from = mapForward(step.from, 1, transactions, t, i);
                const to = mapForward(step.from + step.slice.size, -1, transactions, t, i);
                if (to > from) ops.push({ kind: 'ins', pos: from, from, to });
              }

              // --- deleted inline content → tombstone ---------------------
              if (step.to > step.from && !compositionCommit) {
                const $from = docBefore.resolve(step.from);
                // Schema disallows the mark here (code block): the rewrite
                // cannot express a tombstone — let the delete through.
                if (!$from.parent.type.allowsMarkType(deleteType)) return;

                const deleted = docBefore.slice(step.from, step.to);
                if (!sliceHasInline(deleted)) return; // structural join/split — untracked

                // Undoing your own pending insert: drop the active-id insert
                // segments for real (single-textblock slices only; the marks
                // split text nodes, so whole-node filtering is exact).
                let restore: Slice | null = deleted;
                if (deleted.openStart === 0 && deleted.openEnd === 0) {
                  let allInline = true;
                  deleted.content.forEach((n) => {
                    if (!n.isInline) allInline = false;
                  });
                  if (allInline) {
                    const kept: PMNode[] = [];
                    deleted.content.forEach((n) => {
                      const own = n.marks.some(
                        (m) =>
                          m.type === insertType && m.attrs.suggestionId === storage.suggestionId,
                      );
                      if (!own) kept.push(n);
                    });
                    restore =
                      kept.length === 0
                        ? null
                        : kept.length === deleted.content.childCount
                          ? deleted
                          : new Slice(Fragment.from(kept), 0, 0);
                  }
                }
                if (!restore) return; // entire deletion was our own pending insert

                const dir: 'back' | 'fwd' =
                  selBefore?.empty && selBefore.head === step.from ? 'fwd' : 'back';
                const pos = mapForward(step.from, -1, transactions, t, i);
                // Pure deletions own the caret; type-over keeps PM's caret
                // (after the typed text), which our insert remaps correctly.
                const setSel = step.slice.size === 0 && !sawSelOwner;
                if (setSel) sawSelOwner = true;
                ops.push({ kind: 'del', pos, slice: restore, dir, setSel });
              }
            });
          });

          // Composition commit: mark the surviving accumulated ranges once.
          for (const r of pending) {
            ops.push({ kind: 'ins', pos: r.from, from: r.from, to: r.to });
          }

          if (ops.length === 0) {
            if (compositionCommit) {
              return newState.tr.setMeta(suggestionAutoMarkPluginKey, {
                type: 'clear',
              } satisfies AutoMarkMeta);
            }
            return null;
          }

          // Apply back-to-front: restores only INSERT content, so ops at lower
          // positions never invalidate already-applied higher ones, and mark
          // ranges travel with their text. Ties: mark the typed text before
          // restoring the tombstone at the same position (type-over order:
          // struck old text, then marked new text).
          ops.sort((a, b) => b.pos - a.pos || (a.kind === 'ins' ? -1 : 1));

          const tr = newState.tr;
          const attrs = attrsFor(storage);
          let selAnchor: number | null = null;
          let selDir: 'back' | 'fwd' = 'back';

          for (const op of ops) {
            if (op.kind === 'ins') {
              tr.addMark(op.from, op.to, insertType.create(attrs));
              continue;
            }
            tr.replace(op.pos, op.pos, op.slice);
            const end = op.pos + op.slice.size;
            // Strike everything restored that isn't already someone's
            // tombstone (keep other suggestions' delete marks intact).
            tr.doc.nodesBetween(op.pos, end, (node, nodePos) => {
              if (!node.isInline) return true;
              if (node.marks.some((m) => m.type === deleteType)) return false;
              tr.addMark(
                Math.max(op.pos, nodePos),
                Math.min(end, nodePos + node.nodeSize),
                deleteType.create(attrs),
              );
              return false;
            });
            // Later (lower-position) restores shift a recorded caret right.
            if (selAnchor !== null && op.pos < selAnchor) selAnchor += op.slice.size;
            if (op.setSel) {
              selDir = op.dir;
              selAnchor = op.dir === 'fwd' ? end : op.pos;
            }
          }

          if (selAnchor !== null) {
            const clamped = Math.max(0, Math.min(selAnchor, tr.doc.content.size));
            tr.setSelection(TextSelection.near(tr.doc.resolve(clamped), selDir === 'fwd' ? 1 : -1));
          }

          tr.setMeta(suggestionAutoMarkPluginKey, { type: 'clear' } satisfies AutoMarkMeta);
          return tr;
        },
      }),
    ];
  },
});

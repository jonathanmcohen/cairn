import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { baseExtensions } from '@/components/editor/extensions';

/**
 * The v0.3.0 Yjs custom-node audit (spec decision #4): a doc containing every
 * new P4 node must survive encode → decode unchanged. y-prosemirror only syncs
 * state derived from ProseMirror attrs/content; a node holding non-attr state
 * would drop or desync here.
 *
 * `getSchema(baseExtensions())` builds the ProseMirror schema from the SAME
 * extension set the collaborative editor uses, so the schema under test is the
 * real one (toggle/columnList/column/table all registered).
 */
const schema = getSchema(baseExtensions());

// 'default' is the Yjs XML fragment field y-prosemirror uses for the doc root.
const FIELD = 'default';

function roundTrip(docJSON: Record<string, unknown>): Record<string, unknown> {
  // Validate the JSON is a legal doc for our schema before encoding.
  PMNode.fromJSON(schema, docJSON);
  const ydoc = prosemirrorJSONToYDoc(schema, docJSON, FIELD);
  const update = Y.encodeStateAsUpdate(ydoc);
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, update);
  return yDocToProsemirrorJSON(fresh, FIELD) as Record<string, unknown>;
}

const para = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

describe('P4 blocks survive a Yjs round-trip', () => {
  it('toggle (collapsed) round-trips with its open=false attr and children', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'toggle',
          attrs: { open: false },
          content: [para('inside the toggle')],
        },
      ],
    };
    const out = roundTrip(doc);
    expect(out).toEqual(doc);
  });

  it('two-column columnList round-trips with both columns + content', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [para('left')] },
            { type: 'column', content: [para('right')] },
          ],
        },
      ],
    };
    const out = roundTrip(doc);
    expect(out).toEqual(doc);
  });

  it('simple table round-trips with header + body cells', () => {
    // The official @tiptap/extension-table cell/header nodes carry mandatory
    // colspan/rowspan attrs (default 1); the schema fills them in, so the
    // round-trip emits them. Include them in the input doc so the assertion
    // tests true structural identity rather than relaxing toEqual.
    const cell = (text: string) => ({
      type: 'tableCell',
      attrs: { colspan: 1, rowspan: 1 },
      content: [para(text)],
    });
    const header = (text: string) => ({
      type: 'tableHeader',
      attrs: { colspan: 1, rowspan: 1 },
      content: [para(text)],
    });
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [header('A'), header('B')] },
            { type: 'tableRow', content: [cell('1'), cell('2')] },
          ],
        },
      ],
    };
    const out = roundTrip(doc);
    expect(out).toEqual(doc);
  });

  it('a kitchen-sink doc with every P4 node + a divider survives intact', () => {
    const doc = {
      type: 'doc',
      content: [
        para('before'),
        { type: 'horizontalRule' },
        {
          type: 'toggle',
          attrs: { open: true },
          content: [para('t')],
        },
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [para('c1')] },
            { type: 'column', content: [para('c2')] },
          ],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { colspan: 1, rowspan: 1 },
                  content: [para('x')],
                },
                {
                  type: 'tableCell',
                  attrs: { colspan: 1, rowspan: 1 },
                  content: [para('y')],
                },
              ],
            },
          ],
        },
        para('after'),
      ],
    };
    const out = roundTrip(doc);
    expect(out).toEqual(doc);
  });
});

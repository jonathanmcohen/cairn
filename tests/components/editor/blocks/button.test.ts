import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { sanitizeButtonHref } from '@/components/editor/blocks/button-node';
import { baseExtensions } from '@/components/editor/extensions';

/**
 * v0.8.0 P24 button audit: the new `button` node — an atomic block with attrs
 * `{label, href, variant}` rendered as `<a class="btn ..." href="...">label</a>` —
 * must survive a ProseMirror schema parse/serialize round-trip AND a Yjs
 * encode/decode with attrs intact. Separately, the `sanitizeButtonHref`
 * helper that powers `renderHTML` must reject unsafe URL schemes so a stored
 * `javascript:` payload never reaches the rendered DOM.
 */
const schema = getSchema(baseExtensions());
const FIELD = 'default';

describe('v0.8.0 P24 button block — schema + Yjs round-trip', () => {
  it('parses through the real schema and back, preserving every attr', () => {
    const DOC = {
      type: 'doc',
      content: [
        {
          type: 'button',
          attrs: { label: 'Click me', href: 'https://example.com', variant: 'primary' },
        },
      ],
    };
    const node = PMNode.fromJSON(schema, DOC);
    const json = node.toJSON();
    expect(json).toEqual(DOC);
  });

  it('honors variant=secondary across the Yjs encode/decode', () => {
    const DOC = {
      type: 'doc',
      content: [
        {
          type: 'button',
          attrs: { label: 'X', href: 'https://example.com', variant: 'secondary' },
        },
      ],
    };
    PMNode.fromJSON(schema, DOC);
    const ydoc = prosemirrorJSONToYDoc(schema, DOC, FIELD);
    const update = Y.encodeStateAsUpdate(ydoc);
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, update);
    const out = yDocToProsemirrorJSON(fresh, FIELD) as typeof DOC;
    expect(out).toEqual(DOC);
  });

  it('round-trips a primary button through Yjs encode/decode unchanged', () => {
    const DOC = {
      type: 'doc',
      content: [
        {
          type: 'button',
          attrs: { label: 'Hello', href: 'https://example.com/path', variant: 'primary' },
        },
      ],
    };
    PMNode.fromJSON(schema, DOC);
    const ydoc = prosemirrorJSONToYDoc(schema, DOC, FIELD);
    const update = Y.encodeStateAsUpdate(ydoc);
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, update);
    const out = yDocToProsemirrorJSON(fresh, FIELD) as typeof DOC;
    expect(out).toEqual(DOC);
  });

  it('exposes a button node spec marked atom + block', () => {
    const buttonSpec = schema.nodes.button;
    expect(buttonSpec).toBeDefined();
    expect(buttonSpec?.isAtom).toBe(true);
    expect(buttonSpec?.isBlock).toBe(true);
  });
});

describe('sanitizeButtonHref', () => {
  it('passes through http/https/mailto', () => {
    expect(sanitizeButtonHref('https://example.com/path')).toBe('https://example.com/path');
    expect(sanitizeButtonHref('http://example.com')).toBe('http://example.com/');
    expect(sanitizeButtonHref('mailto:a@b.com')).toBe('mailto:a@b.com');
  });

  it('rejects javascript: + data: schemes by returning "#"', () => {
    expect(sanitizeButtonHref('javascript:alert(1)')).toBe('#');
    expect(sanitizeButtonHref('data:text/html,<script>1</script>')).toBe('#');
  });

  it('returns "#" for non-string + malformed inputs', () => {
    expect(sanitizeButtonHref(null)).toBe('#');
    expect(sanitizeButtonHref(undefined)).toBe('#');
    expect(sanitizeButtonHref(123)).toBe('#');
    expect(sanitizeButtonHref('not a url')).toBe('#');
  });
});

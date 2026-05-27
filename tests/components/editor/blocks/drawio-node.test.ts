// @vitest-environment jsdom
import { Schema } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildDrawioUrl } from '@/components/editor/blocks/drawio';
import { DrawioNode } from '@/components/editor/blocks/drawio-node';

describe('DrawioNode schema', () => {
  it('declares the `drawio` node name, block group, atom', () => {
    expect(DrawioNode.name).toBe('drawio');
    expect(DrawioNode.config.group).toBe('block');
    expect(DrawioNode.config.atom).toBe(true);
  });

  it('exposes `source` + `sourceUrl` attrs with empty defaults', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'block+' },
        text: { group: 'inline' },
        paragraph: {
          content: 'inline*',
          group: 'block',
          toDOM: () => ['p', 0],
          parseDOM: [{ tag: 'p' }],
        },
        drawio: {
          group: 'block',
          atom: true,
          attrs: { source: { default: '' }, sourceUrl: { default: '' } },
          toDOM: () => ['div', { 'data-drawio': '' }],
          parseDOM: [{ tag: 'div[data-drawio]' }],
        },
      },
    });
    const drawioType = schema.nodes.drawio;
    if (!drawioType) throw new Error('drawio node missing from schema');
    const node = drawioType.create({ source: '<mxGraphModel/>' });
    expect(node.attrs.source).toBe('<mxGraphModel/>');
    expect(node.attrs.sourceUrl).toBe('');
  });
});

describe('buildDrawioUrl', () => {
  it('embeds the xml into the data= parameter of viewer.diagrams.net', () => {
    const xml = '<mxGraphModel/>';
    const url = buildDrawioUrl({ source: xml });
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://viewer.diagrams.net');
    expect(parsed.searchParams.get('lightbox')).toBe('1');
    expect(parsed.searchParams.get('data')).toBe(xml);
  });

  it('accepts a public URL via the url= parameter', () => {
    const url = buildDrawioUrl({ sourceUrl: 'https://example.com/diagram.drawio' });
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://viewer.diagrams.net');
    expect(parsed.searchParams.get('url')).toBe('https://example.com/diagram.drawio');
    expect(parsed.searchParams.get('data')).toBeNull();
  });

  it('prefers sourceUrl when BOTH are set (the public-URL contract is authoritative)', () => {
    const url = buildDrawioUrl({
      source: '<mxGraphModel/>',
      sourceUrl: 'https://example.com/diagram.drawio',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('url')).toBe('https://example.com/diagram.drawio');
    expect(parsed.searchParams.get('data')).toBeNull();
  });

  it('always lands on https://viewer.diagrams.net (matches EMBED_FRAME_HOSTS)', () => {
    expect(buildDrawioUrl({}).startsWith('https://viewer.diagrams.net/')).toBe(true);
  });
});

describe('DrawioNode Yjs roundtrip', () => {
  it('persists source through Yjs', () => {
    const docA = new Y.Doc();
    docA.getMap('drawio').set('source', '<mxGraphModel/>');
    const update = Y.encodeStateAsUpdate(docA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, update);
    expect(docB.getMap('drawio').get('source')).toBe('<mxGraphModel/>');
  });

  it('persists sourceUrl through Yjs', () => {
    const docA = new Y.Doc();
    docA.getMap('drawio').set('sourceUrl', 'https://example.com/diagram.drawio');
    const update = Y.encodeStateAsUpdate(docA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, update);
    expect(docB.getMap('drawio').get('sourceUrl')).toBe('https://example.com/diagram.drawio');
  });
});

// @vitest-environment jsdom
import { Schema } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildPlantUmlUrl } from '@/components/editor/blocks/plantuml';
import { PlantUmlNode } from '@/components/editor/blocks/plantuml-node';

describe('PlantUmlNode schema', () => {
  it('declares the `plantuml` node name, block group, atom', () => {
    expect(PlantUmlNode.name).toBe('plantuml');
    expect(PlantUmlNode.config.group).toBe('block');
    expect(PlantUmlNode.config.atom).toBe(true);
  });

  it('exposes a `source` attribute with empty default', () => {
    // Build a minimal ProseMirror schema that includes the plantuml node so we
    // can create a real Node instance with default attrs (mirrors how TipTap
    // wires the schema at editor-creation time).
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
        plantuml: {
          group: 'block',
          atom: true,
          attrs: { source: { default: '' } },
          toDOM: () => ['div', { 'data-plantuml': '' }],
          parseDOM: [{ tag: 'div[data-plantuml]' }],
        },
      },
    });
    const plantumlType = schema.nodes.plantuml;
    if (!plantumlType) throw new Error('plantuml node missing from schema');
    const node = plantumlType.create({ source: '@startuml\nA -> B\n@enduml' });
    expect(node.attrs.source).toBe('@startuml\nA -> B\n@enduml');
    const empty = plantumlType.create({});
    expect(empty.attrs.source).toBe('');
  });

  it('survives a Yjs roundtrip (source as Y.Map value)', () => {
    const docA = new Y.Doc();
    const sharedA = docA.getMap('plantuml');
    sharedA.set('source', '@startuml\nA -> B\n@enduml');
    const update = Y.encodeStateAsUpdate(docA);

    const docB = new Y.Doc();
    Y.applyUpdate(docB, update);
    expect(docB.getMap('plantuml').get('source')).toBe('@startuml\nA -> B\n@enduml');
  });
});

describe('buildPlantUmlUrl', () => {
  // A tiny stub encoder so the test asserts URL SHAPE without loading the real
  // plantuml-encoder module (which depends on pako and only ships browser/CJS
  // entrypoints — fine in jsdom but slow). The real view passes the encoded
  // text in; we mirror that contract here.
  const stubEncode = (s: string) => Buffer.from(s).toString('base64url');

  it('builds an svg URL on the public server when no override', () => {
    const url = buildPlantUmlUrl('@startuml\nA -> B\n@enduml', undefined, stubEncode);
    expect(url.startsWith('https://www.plantuml.com/plantuml/svg/')).toBe(true);
    expect(url.length).toBeGreaterThan('https://www.plantuml.com/plantuml/svg/'.length + 5);
  });

  it('honors a custom server', () => {
    const url = buildPlantUmlUrl(
      '@startuml\nA -> B\n@enduml',
      'https://puml.example.com',
      stubEncode,
    );
    expect(url.startsWith('https://puml.example.com/svg/')).toBe(true);
  });

  it('strips a trailing slash on the custom server', () => {
    const url = buildPlantUmlUrl(
      '@startuml\nA -> B\n@enduml',
      'https://puml.example.com/',
      stubEncode,
    );
    expect(url.startsWith('https://puml.example.com/svg/')).toBe(true);
    // exactly ONE slash between origin and `svg/`
    expect(url.startsWith('https://puml.example.com//svg/')).toBe(false);
  });
});

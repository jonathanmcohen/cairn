// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  EDITOR_NODE_NAMES,
  loadEditorExtension,
  nodeNamesInDoc,
} from '@/components/editor/extensions-lazy';

describe('extensions-lazy', () => {
  it('exposes the lazy node names (math/syncedBlock/embed/mermaid/plantuml/drawio)', () => {
    expect(EDITOR_NODE_NAMES).toEqual([
      'math',
      'syncedBlock',
      'embed',
      'mermaid',
      'plantuml',
      'drawio',
    ]);
  });

  it('loadEditorExtension("math") returns a TipTap-extension-shaped object', async () => {
    const ext = await loadEditorExtension('math');
    // TipTap Node/Mark/Extension instances share `.name` + `.type` at runtime;
    // we only need to assert it loaded SOMETHING with a name field.
    expect(ext).toBeDefined();
    expect(typeof (ext as { name?: string }).name).toBe('string');
  });

  it('loadEditorExtension("syncedBlock") loads its module on demand', async () => {
    const ext = await loadEditorExtension('syncedBlock');
    expect(ext).toBeDefined();
  });

  it('loadEditorExtension("embed") loads its module on demand', async () => {
    const ext = await loadEditorExtension('embed');
    expect(ext).toBeDefined();
  });

  it('loadEditorExtension("mermaid") loads its module on demand', async () => {
    const ext = await loadEditorExtension('mermaid');
    expect(ext).toBeDefined();
    expect((ext as { name?: string }).name).toBe('mermaid');
  });

  it('loadEditorExtension("plantuml") loads its module on demand', async () => {
    const ext = await loadEditorExtension('plantuml');
    expect(ext).toBeDefined();
    expect((ext as { name?: string }).name).toBe('plantuml');
  });

  it('loadEditorExtension("drawio") loads its module on demand', async () => {
    const ext = await loadEditorExtension('drawio');
    expect(ext).toBeDefined();
    expect((ext as { name?: string }).name).toBe('drawio');
  });

  it('loadEditorExtension throws on an unknown name', async () => {
    await expect(loadEditorExtension('not-a-real-name' as never)).rejects.toThrow();
  });

  it('nodeNamesInDoc walks a ProseMirror JSON doc and reports lazy node names present', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
        { type: 'math', attrs: { latex: 'x^2' } },
        {
          type: 'columnList',
          content: [
            {
              type: 'column',
              content: [{ type: 'embed', attrs: { provider: 'youtube', src: 'https://…' } }],
            },
          ],
        },
      ],
    };
    expect(nodeNamesInDoc(doc).sort()).toEqual(['embed', 'math']);
  });

  it('nodeNamesInDoc returns an empty array for a doc with none of the lazy nodes', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(nodeNamesInDoc(doc)).toEqual([]);
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { GalleryNode } from '@/components/editor/blocks/gallery-node';

describe('GalleryNode schema', () => {
  it('declares group=block, content=cairnImage+, atom=false', () => {
    expect(GalleryNode.name).toBe('gallery');
    const cfg = GalleryNode.config as { group: string; content: string; atom?: boolean };
    expect(cfg.group).toBe('block');
    expect(cfg.content).toBe('cairnImage+');
    expect(cfg.atom).not.toBe(true);
  });

  it('survives Yjs roundtrip (3 children)', () => {
    const docA = new Y.Doc();
    const arr = docA.getArray<string>('gallery-children');
    arr.push(['file-1', 'file-2', 'file-3']);
    const update = Y.encodeStateAsUpdate(docA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, update);
    expect(docB.getArray<string>('gallery-children').toArray()).toEqual([
      'file-1',
      'file-2',
      'file-3',
    ]);
  });
});

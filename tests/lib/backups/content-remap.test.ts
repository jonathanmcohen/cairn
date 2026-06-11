import { describe, expect, it } from 'vitest';
import { type ContentRemapMaps, remapDocContent, remapIdsDeep } from '@/lib/backups/content-remap';

// v0.10.0 C4 — pure ProseMirror-JSON remap for selective restore. These cover
// the node types that embed row ids in attrs (database / pageLink /
// pageMention / pageEmbed / file-backed nodes) plus the strip-on-missing-blob
// and leave-unmapped-references policies documented in the module header.

const OLD_PAGE = '11111111-1111-1111-1111-111111111111';
const NEW_PAGE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OLD_DB = '22222222-2222-2222-2222-222222222222';
const NEW_DB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OLD_FILE = '33333333-3333-3333-3333-333333333333';
const NEW_FILE = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const MISSING_FILE = '44444444-4444-4444-4444-444444444444';
const OUTSIDE_PAGE = '55555555-5555-5555-5555-555555555555';

function maps(): ContentRemapMaps {
  return {
    pageIds: new Map([[OLD_PAGE, NEW_PAGE]]),
    databaseIds: new Map([[OLD_DB, NEW_DB]]),
    fileIds: new Map([[OLD_FILE, NEW_FILE]]),
    skippedFileIds: new Set([MISSING_FILE]),
  };
}

describe('remapDocContent', () => {
  it('remaps database node attrs.databaseId', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'database', attrs: { databaseId: OLD_DB } }],
    };
    const out = remapDocContent(doc, maps()) as { content: { attrs: { databaseId: string } }[] };
    expect(out.content[0]?.attrs.databaseId).toBe(NEW_DB);
    // input not mutated
    expect(doc.content[0]?.attrs.databaseId).toBe(OLD_DB);
  });

  it('remaps targetPageId on pageLink / pageMention / pageEmbed', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'pageEmbed', attrs: { targetPageId: OLD_PAGE, label: 'A' } },
        {
          type: 'paragraph',
          content: [
            { type: 'pageLink', attrs: { targetPageId: OLD_PAGE, label: 'A' } },
            { type: 'pageMention', attrs: { targetPageId: OLD_PAGE, label: 'A' } },
          ],
        },
      ],
    };
    const out = remapDocContent(doc, maps()) as {
      content: [
        { attrs: { targetPageId: string } },
        { content: { attrs: { targetPageId: string } }[] },
      ];
    };
    expect(out.content[0].attrs.targetPageId).toBe(NEW_PAGE);
    expect(out.content[1].content[0]?.attrs.targetPageId).toBe(NEW_PAGE);
    expect(out.content[1].content[1]?.attrs.targetPageId).toBe(NEW_PAGE);
  });

  it('leaves references OUTSIDE the restored set untouched (renders as missing link, no crash)', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'pageLink', attrs: { targetPageId: OUTSIDE_PAGE, label: 'X' } }],
    };
    const out = remapDocContent(doc, maps()) as { content: { attrs: { targetPageId: string } }[] };
    expect(out.content[0]?.attrs.targetPageId).toBe(OUTSIDE_PAGE);
  });

  it('remaps fileId + rewrites src/href on file-backed nodes, dropping stale signatures', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'cairnImage',
          attrs: { fileId: OLD_FILE, src: `/api/files/${OLD_FILE}?sig=abc&exp=1`, alt: 'pic' },
        },
        {
          type: 'fileAttachment',
          attrs: { fileId: OLD_FILE, href: `/api/files/${OLD_FILE}?sig=abc&exp=1`, name: 'f' },
        },
      ],
    };
    const out = remapDocContent(doc, maps()) as {
      content: [{ attrs: { fileId: string; src: string } }, { attrs: { href: string } }];
    };
    expect(out.content[0].attrs.fileId).toBe(NEW_FILE);
    expect(out.content[0].attrs.src).toBe(`/api/files/${NEW_FILE}`);
    expect(out.content[1].attrs.href).toBe(`/api/files/${NEW_FILE}`);
  });

  it('strips file/image nodes whose binary is missing, and empty galleries with them', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'keep me' }] },
        { type: 'cairnImage', attrs: { fileId: MISSING_FILE, src: 'x', alt: '' } },
        {
          type: 'gallery',
          content: [{ type: 'cairnImage', attrs: { fileId: MISSING_FILE, src: 'x', alt: '' } }],
        },
      ],
    };
    const out = remapDocContent(doc, maps()) as { content: { type: string }[] };
    expect(out.content.map((n) => n.type)).toEqual(['paragraph']);
  });

  it('passes non-object content through unchanged', () => {
    expect(remapDocContent(null, maps())).toBeNull();
    expect(remapDocContent('weird', maps())).toBe('weird');
  });
});

describe('remapIdsDeep', () => {
  it('remaps exact-match uuid strings anywhere in nested jsonb', () => {
    const idMap = new Map([[OLD_PAGE, NEW_PAGE]]);
    const value = {
      relation: [OLD_PAGE, OUTSIDE_PAGE],
      nested: { target: OLD_PAGE, label: `not ${OLD_PAGE} exact` },
      count: 3,
      flag: true,
      empty: null,
    };
    expect(remapIdsDeep(value, idMap)).toEqual({
      relation: [NEW_PAGE, OUTSIDE_PAGE],
      nested: { target: NEW_PAGE, label: `not ${OLD_PAGE} exact` },
      count: 3,
      flag: true,
      empty: null,
    });
  });
});

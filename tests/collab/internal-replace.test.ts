import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { Hocuspocus } from '@hocuspocus/server';
import { describe, expect, it, vi } from 'vitest';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { handleInternalReplace } from '../../collab/internal-replace';

type FakeInstance = Pick<Hocuspocus, 'documents' | 'openDirectConnection'>;

const SECRET = 'x'.repeat(32);

// Build a fake IncomingMessage from a JSON body + headers.
function fakeReq(opts: { method?: string; url: string; authorization?: string; body?: unknown }) {
  const json = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = Readable.from([Buffer.from(json)]) as unknown as {
    method?: string;
    url?: string;
    headers: Record<string, string | undefined>;
  };
  req.method = opts.method ?? 'POST';
  req.url = opts.url;
  req.headers = { authorization: opts.authorization };
  return req as unknown as IncomingMessage;
}

// Capture writeHead/end on a fake ServerResponse.
function fakeRes() {
  const res = new EventEmitter() as unknown as {
    statusCode?: number;
    body?: string;
    writeHead: (s: number, h?: unknown) => unknown;
    end: (b?: string) => unknown;
  };
  res.writeHead = (s: number) => {
    res.statusCode = s;
    return res;
  };
  res.end = (b?: string) => {
    res.body = b;
    return res;
  };
  return res as unknown as ServerResponse;
}

// Fake Hocuspocus instance: a documents map + an openDirectConnection that
// mutates a real Y.Doc via a DirectConnection-shaped object. The handler only
// touches `.documents.has` and `.openDirectConnection`, so the narrow Pick is a
// faithful stand-in (cast through unknown since Y.Doc ≠ Hocuspocus Document).
function fakeInstance(loaded: Map<string, Y.Doc>): FakeInstance & {
  openDirectConnection: ReturnType<typeof vi.fn>;
} {
  return {
    documents: loaded as unknown as Hocuspocus['documents'],
    openDirectConnection: vi.fn(async (name: string) => {
      const doc = loaded.get(name);
      if (!doc) throw new Error('not loaded');
      return {
        transact: async (fn: (d: { getXmlFragment: (k: string) => Y.XmlFragment }) => void) => {
          doc.transact(() => fn(doc));
        },
        disconnect: () => {},
      };
    }) as unknown as Hocuspocus['openDirectConnection'] & ReturnType<typeof vi.fn>,
  };
}

const replaceDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'API-written content' }],
    },
  ],
};

describe('handleInternalReplace', () => {
  it('ignores non-matching paths/methods (returns false, no response)', async () => {
    const res = fakeRes();
    const handled = await handleInternalReplace(
      fakeReq({ method: 'GET', url: '/healthz' }),
      res,
      fakeInstance(new Map()),
      SECRET,
    );
    expect(handled).toBe(false);
    expect((res as unknown as { statusCode?: number }).statusCode).toBeUndefined();
  });

  it('401s a request without the correct bearer secret', async () => {
    const res = fakeRes();
    const handled = await handleInternalReplace(
      fakeReq({ url: '/internal/pages/abc/replace', authorization: 'Bearer wrong', body: {} }),
      res,
      fakeInstance(new Map([['abc', new Y.Doc()]])),
      SECRET,
    );
    expect(handled).toBe(true);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it('404s (no-op) when the doc is NOT currently open — DB write stands', async () => {
    const inst = fakeInstance(new Map()); // empty: no doc loaded
    const res = fakeRes();
    const handled = await handleInternalReplace(
      fakeReq({
        url: '/internal/pages/abc/replace',
        authorization: `Bearer ${SECRET}`,
        body: { content: replaceDoc },
      }),
      res,
      inst,
      SECRET,
    );
    expect(handled).toBe(true);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(404);
    // MUST NOT have opened/loaded the doc.
    expect(inst.openDirectConnection).not.toHaveBeenCalled();
  });

  it('applies the content to the LIVE doc when it is open (the #A3 fix)', async () => {
    const doc = new Y.Doc();
    // Seed the doc with stale content the materialize flush would have kept.
    doc.transact(() => {
      const frag = doc.getXmlFragment('default');
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, 'stale editor content');
      p.insert(0, [t]);
      frag.insert(0, [p]);
    });
    const inst = fakeInstance(new Map([['page-1', doc]]));
    const res = fakeRes();

    const handled = await handleInternalReplace(
      fakeReq({
        url: '/internal/pages/page-1/replace',
        authorization: `Bearer ${SECRET}`,
        body: { content: replaceDoc },
      }),
      res,
      inst,
      SECRET,
    );

    expect(handled).toBe(true);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(200);
    // The live doc now reflects the API write, NOT the stale content.
    const str = JSON.stringify(yDocToProsemirrorJSON(doc, 'default'));
    expect(str).toContain('API-written content');
    expect(str).not.toContain('stale editor content');
  });

  it('400s when content is missing', async () => {
    const res = fakeRes();
    const handled = await handleInternalReplace(
      fakeReq({
        url: '/internal/pages/page-1/replace',
        authorization: `Bearer ${SECRET}`,
        body: { notContent: true },
      }),
      res,
      fakeInstance(new Map([['page-1', new Y.Doc()]])),
      SECRET,
    );
    expect(handled).toBe(true);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
  });
});

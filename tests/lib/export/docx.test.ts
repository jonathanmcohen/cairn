import { expect, it } from 'vitest';
import { pageToDocx } from '@/lib/export/docx';

const page = {
  id: 'p1',
  title: 'Doc Title',
  content: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Section' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello body' }] },
    ],
  },
};

it('produces a valid OOXML (.docx) buffer with a PK zip header (#56)', async () => {
  const buf = await pageToDocx(page);
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf.length).toBeGreaterThan(0);
  expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
});

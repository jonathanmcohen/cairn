import { afterAll, describe, expect, it } from 'vitest';
import { closePdfNativeBrowserForTests, pageToPdf } from '@/lib/export/pdf-native';

const ENABLED = process.env.CAIRN_TEST_NATIVE_PDF === '1';
const describeOrSkip = ENABLED ? describe : describe.skip;

describeOrSkip('pdf-native (gated by CAIRN_TEST_NATIVE_PDF=1)', () => {
  afterAll(async () => {
    await closePdfNativeBrowserForTests();
  });

  it('returns a Buffer whose first five bytes are the PDF magic header', async () => {
    const page = {
      id: '00000000-0000-0000-0000-000000000001',
      title: 'Smoke',
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
      },
    };
    const buf = await pageToPdf(page);
    // %PDF- (0x25 0x50 0x44 0x46 0x2D) is the PDF magic header.
    expect(buf.toString('utf8', 0, 5)).toBe('%PDF-');
    // Sanity: a real rendered single-paragraph page is well over 1KB once
    // the PDF structure (xref, trailer, embedded fonts) is included.
    expect(buf.byteLength).toBeGreaterThanOrEqual(1024);
  });
});

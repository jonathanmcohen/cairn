import { describe, expect, it, vi } from 'vitest';
import { extractOpenGraph } from '@/lib/unfurl/og-extract';

const SAMPLE_HTML = `
<!doctype html>
<html>
<head>
  <title>Sample title</title>
  <meta property="og:title" content="OG title" />
  <meta property="og:description" content="OG description text" />
  <meta property="og:image" content="https://example.com/cover.jpg" />
  <link rel="icon" href="/favicon.ico" />
</head>
<body></body>
</html>
`;

describe('extractOpenGraph', () => {
  it('returns title/description/image/favicon from a typical page', async () => {
    const result = await extractOpenGraph({
      html: SAMPLE_HTML,
      baseUrl: 'https://example.com/article',
      fetchImage: async () => null, // skip image fetch
    });
    expect(result.title).toBe('OG title');
    expect(result.description).toBe('OG description text');
    expect(result.image).toBe('https://example.com/cover.jpg');
    expect(result.favicon).toBe('https://example.com/favicon.ico');
    expect(result.imageData).toBeNull();
  });

  it('embeds image bytes as a data: URL when fetchImage returns', async () => {
    const fakeBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // jpeg-ish
    const result = await extractOpenGraph({
      html: SAMPLE_HTML,
      baseUrl: 'https://example.com/article',
      fetchImage: async (url) => {
        expect(url).toBe('https://example.com/cover.jpg');
        return { bytes: fakeBytes, contentType: 'image/jpeg' };
      },
    });
    expect(result.imageData?.startsWith('data:image/jpeg;base64,')).toBe(true);
    // Decoding the base64 portion should match the original bytes.
    const b64 = result.imageData?.split(',')[1] ?? '';
    expect(Buffer.from(b64, 'base64').equals(Buffer.from(fakeBytes))).toBe(true);
  });

  it('skips the image fetch (imageData: null) when there is no og:image', async () => {
    const fetchSpy = vi.fn();
    const result = await extractOpenGraph({
      html: '<html><head><title>No image</title></head></html>',
      baseUrl: 'https://example.com/',
      fetchImage: fetchSpy,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.imageData).toBeNull();
    expect(result.image).toBeNull();
  });

  it('falls back to imageData: null when fetchImage returns null (e.g. SSRF-refused or too-large)', async () => {
    const result = await extractOpenGraph({
      html: SAMPLE_HTML,
      baseUrl: 'https://example.com/article',
      fetchImage: async () => null,
    });
    expect(result.image).toBe('https://example.com/cover.jpg');
    expect(result.imageData).toBeNull();
  });

  it('uses og:title with fall back to <title>', async () => {
    const result = await extractOpenGraph({
      html: '<html><head><title>Title fallback</title></head></html>',
      baseUrl: 'https://example.com/',
      fetchImage: async () => null,
    });
    expect(result.title).toBe('Title fallback');
  });
});

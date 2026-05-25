import { parseOgTags } from '@/lib/editor/og-parse';

export type ExtractedOg = {
  title: string | null;
  description: string | null;
  image: string | null;
  /** Base64 data URL of the og:image bytes (caller-fetched), or null. */
  imageData: string | null;
  favicon: string;
};

export type FetchedImage = { bytes: Uint8Array; contentType: string };

export type ExtractOpenGraphInput = {
  html: string;
  baseUrl: string;
  /**
   * Caller-provided image fetcher. The /api/unfurl route wires this up to go
   * through the existing SSRF guard + 256 KB cap. Returns null if the fetch
   * was refused, too large, or otherwise unsafe.
   */
  fetchImage: (url: string) => Promise<FetchedImage | null>;
};

/**
 * Extract OpenGraph metadata from a fetched HTML body. Delegates HTML parsing
 * to `parseOgTags` (regex-based, dependency-free). When the page exposes an
 * og:image, asks the caller to fetch it (with the caller's SSRF guard + size
 * cap) and inlines the result as a data: URL so the bookmark card renders
 * without an extra cross-origin image request.
 */
export async function extractOpenGraph(input: ExtractOpenGraphInput): Promise<ExtractedOg> {
  const parsed = parseOgTags(input.html, input.baseUrl);

  let imageData: string | null = null;
  if (parsed.image) {
    const fetched = await input.fetchImage(parsed.image);
    if (fetched) {
      const b64 = Buffer.from(fetched.bytes).toString('base64');
      imageData = `data:${fetched.contentType};base64,${b64}`;
    }
  }

  return {
    title: parsed.title,
    description: parsed.description,
    image: parsed.image,
    imageData,
    favicon: parsed.favicon,
  };
}

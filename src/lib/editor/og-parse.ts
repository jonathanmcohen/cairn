/**
 * Hand-rolled Open-Graph / <title> / favicon extractor. Pure (string in, object
 * out) so it unit-tests without a browser. Deliberately tolerant: it scans the
 * head with targeted regex rather than a full HTML parser to keep the dependency
 * surface zero and the byte cost predictable. The caller (the /api/unfurl route)
 * is responsible for the SSRF guard + byte cap before this ever sees a string.
 */

export type Unfurled = {
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** First `content` of a `<meta property|name="key">` (order: property then name). */
function meta(html: string, key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
    'i',
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const content = tag.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content.trim()) : null;
}

function resolve(href: string | null, baseUrl: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

export function parseOgTags(html: string, baseUrl: string): Unfurled {
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = meta(html, 'og:title') ?? (titleTag ? decodeEntities(titleTag.trim()) : null);
  const description = meta(html, 'og:description') ?? meta(html, 'description');
  const image = resolve(meta(html, 'og:image'), baseUrl);

  const iconHref = html
    .match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i)?.[0]
    ?.match(/href=["']([^"']*)["']/i)?.[1];
  const favicon = resolve(iconHref ?? null, baseUrl) ?? resolve('/favicon.ico', baseUrl) ?? baseUrl;

  return { title, description, image, favicon };
}

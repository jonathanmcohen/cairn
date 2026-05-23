import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from './config';

type WeightedTag = { tag: string; q: number };

export function parseAcceptLanguage(header: string | null | undefined): WeightedTag[] {
  if (!header) return [];
  const parts = header.split(',');
  const tags: WeightedTag[] = [];
  for (const raw of parts) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const [tagPart, ...rest] = trimmed.split(';');
    const tag = tagPart?.trim().toLowerCase();
    if (!tag) continue;
    let q = 1;
    for (const param of rest) {
      const [k, v] = param.trim().split('=');
      if (k === 'q' && v !== undefined) {
        const parsed = Number.parseFloat(v);
        if (!Number.isNaN(parsed)) q = parsed;
      }
    }
    tags.push({ tag, q });
  }
  tags.sort((a, b) => b.q - a.q);
  return tags;
}

export function resolveLocale(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  if (cookie && isLocale(cookie)) return cookie;
  const tags = parseAcceptLanguage(acceptLanguage);
  for (const { tag } of tags) {
    const base = tag.split('-')[0];
    if (base && (LOCALES as readonly string[]).includes(base)) {
      return base as Locale;
    }
  }
  return DEFAULT_LOCALE;
}

import { UAParser } from 'ua-parser-js';

/**
 * #192 — collapse a raw User-Agent string into a short "Browser on OS" label
 * for the active-sessions list. Returns null when there is nothing useful to
 * show (so the UI falls back to its "Unknown device" string). Non-browser
 * agents (CLI tools) return just the product name.
 */
export function friendlyUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const { browser, os } = UAParser(ua);
  // ua-parser-js v2 reports "Mobile Safari" / "Mobile Chrome"; collapse the
  // "Mobile " qualifier so the label reads as the plain browser name.
  const b = browser.name?.trim().replace(/^Mobile /, '');
  const o = os.name?.trim();
  if (b && o) return `${b} on ${o}`;
  if (b) return b;
  if (o) return o;
  // CLI tools like "curl/8.4.0" — UAParser leaves browser empty; take the product.
  const product = ua.split('/')[0]?.trim();
  return product || null;
}

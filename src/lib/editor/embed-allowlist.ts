/**
 * Pure URL → embeddable-iframe-src resolver for the ALLOWLISTED embed providers.
 * Returns null for anything not on the allowlist (arbitrary iframes are refused,
 * per the v0.6.0 design: "allowlist enforced under the CSP, no arbitrary iframes").
 * No I/O, no React. The returned `src` is always https: and always on a host in
 * EMBED_FRAME_HOSTS, so the iframe can be locked to those origins by the CSP.
 */

export type EmbedProvider = 'youtube' | 'vimeo' | 'figma' | 'gist' | 'codesandbox';

export type ResolvedEmbed = {
  provider: EmbedProvider;
  /** Normalized https embed URL, host ∈ EMBED_FRAME_HOSTS. */
  src: string;
};

/** The exact iframe origins the embed node may load — also the CSP `frame-src` set. */
export const EMBED_FRAME_HOSTS = [
  'https://www.youtube.com',
  'https://player.vimeo.com',
  'https://www.figma.com',
  'https://gist.github.com',
  'https://codesandbox.io',
] as const;

const YT_ID = /^[\w-]{11}$/;

function parse(rawUrl: string): URL | null {
  try {
    const u = new URL(rawUrl);
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

function youtube(u: URL): ResolvedEmbed | null {
  const host = u.hostname.replace(/^www\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = u.pathname.slice(1).split('/')[0] ?? null;
  } else if (host === 'youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else if (u.pathname.startsWith('/embed/'))
      id = u.pathname.slice('/embed/'.length).split('/')[0] ?? null;
    else if (u.pathname.startsWith('/shorts/'))
      id = u.pathname.slice('/shorts/'.length).split('/')[0] ?? null;
  }
  if (!id || !YT_ID.test(id)) return null;
  return { provider: 'youtube', src: `https://www.youtube.com/embed/${id}` };
}

function vimeo(u: URL): ResolvedEmbed | null {
  if (u.hostname.replace(/^www\./, '') !== 'vimeo.com') return null;
  const id = u.pathname.slice(1).split('/')[0] ?? '';
  if (!/^\d+$/.test(id)) return null;
  return { provider: 'vimeo', src: `https://player.vimeo.com/video/${id}` };
}

function figma(u: URL): ResolvedEmbed | null {
  const host = u.hostname.replace(/^www\./, '');
  if (host !== 'figma.com') return null;
  if (!/^\/(file|proto|design|board)\//.test(u.pathname)) return null;
  const src = `https://www.figma.com/embed?embed_host=cairn&url=${encodeURIComponent(u.toString())}`;
  return { provider: 'figma', src };
}

function gist(u: URL): ResolvedEmbed | null {
  if (u.hostname !== 'gist.github.com') return null;
  // /<user>/<id> → the .pibb embeddable form.
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { provider: 'gist', src: `https://gist.github.com${u.pathname}.pibb` };
}

function codesandbox(u: URL): ResolvedEmbed | null {
  if (u.hostname.replace(/^www\./, '') !== 'codesandbox.io') return null;
  const m = u.pathname.match(/^\/(?:s|embed)\/([\w-]+)/);
  if (!m?.[1]) return null;
  return { provider: 'codesandbox', src: `https://codesandbox.io/embed/${m[1]}` };
}

const RESOLVERS: Array<(u: URL) => ResolvedEmbed | null> = [
  youtube,
  vimeo,
  figma,
  gist,
  codesandbox,
];

/** Resolve a pasted URL to an embeddable provider/src, or null if not allowlisted. */
export function resolveEmbed(rawUrl: string): ResolvedEmbed | null {
  const u = parse(rawUrl);
  if (!u) return null;
  for (const r of RESOLVERS) {
    const hit = r(u);
    if (hit) return hit;
  }
  return null;
}

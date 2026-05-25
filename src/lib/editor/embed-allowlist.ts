/**
 * Pure URL → embeddable-iframe-src resolver for the ALLOWLISTED embed providers.
 * Returns null for anything not on the allowlist (arbitrary iframes are refused,
 * per the v0.6.0 design: "allowlist enforced under the CSP, no arbitrary iframes").
 * No I/O, no React. The returned `src` is always https: and always on a host in
 * EMBED_FRAME_HOSTS, so the iframe can be locked to those origins by the CSP.
 */

export type EmbedProvider =
  | 'youtube'
  | 'vimeo'
  | 'figma'
  | 'gist'
  | 'codesandbox'
  | 'loom'
  | 'codepen'
  | 'spotify'
  | 'vimeoShowcase'
  | 'excalidraw';

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
  'https://www.loom.com',
  'https://codepen.io',
  'https://open.spotify.com',
  'https://vimeo.com',
  'https://excalidraw.com',
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

const LOOM_ID = /^[A-Za-z0-9]{16,}$/;

function loom(u: URL): ResolvedEmbed | null {
  if (u.hostname.replace(/^www\./, '') !== 'loom.com') return null;
  let id: string | null = null;
  if (u.pathname.startsWith('/share/'))
    id = u.pathname.slice('/share/'.length).split('/')[0] ?? null;
  else if (u.pathname.startsWith('/embed/'))
    id = u.pathname.slice('/embed/'.length).split('/')[0] ?? null;
  if (!id || !LOOM_ID.test(id)) return null;
  return { provider: 'loom', src: `https://www.loom.com/embed/${id}` };
}

function codepen(u: URL): ResolvedEmbed | null {
  if (u.hostname.replace(/^www\./, '') !== 'codepen.io') return null;
  // /<user>/pen/<id>  or  /<user>/embed/<id>
  const m = u.pathname.match(/^\/([\w-]+)\/(?:pen|embed)\/([\w-]+)/);
  if (!m?.[1] || !m?.[2]) return null;
  return { provider: 'codepen', src: `https://codepen.io/${m[1]}/embed/${m[2]}` };
}

const SPOTIFY_TYPES = new Set(['track', 'album', 'playlist', 'episode', 'show']);

function spotify(u: URL): ResolvedEmbed | null {
  if (u.hostname !== 'open.spotify.com') return null;
  // Both /<type>/<id> and /embed/<type>/<id>
  const m = u.pathname.match(/^\/(?:embed\/)?([a-z]+)\/(\w+)/);
  if (!m?.[1] || !m?.[2]) return null;
  if (!SPOTIFY_TYPES.has(m[1])) return null;
  return { provider: 'spotify', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}` };
}

function vimeoShowcase(u: URL): ResolvedEmbed | null {
  if (u.hostname.replace(/^www\./, '') !== 'vimeo.com') return null;
  const m = u.pathname.match(/^\/showcase\/(\d+)/);
  if (!m?.[1]) return null;
  return { provider: 'vimeoShowcase', src: `https://vimeo.com/showcase/${m[1]}/embed` };
}

function excalidraw(u: URL): ResolvedEmbed | null {
  if (u.hostname !== 'excalidraw.com') return null;
  // Accept any path on excalidraw.com — both /#room=... and /embed/?... are
  // valid embed surfaces. Return the original URL untouched (the host alone
  // is the allowlist guard; the CSP also pins it).
  return { provider: 'excalidraw', src: u.toString() };
}

const RESOLVERS: Array<(u: URL) => ResolvedEmbed | null> = [
  youtube,
  // Place vimeoShowcase BEFORE vimeo so `vimeo.com/showcase/...` matches the
  // showcase resolver first. The base vimeo resolver only accepts /\d+/.
  vimeoShowcase,
  vimeo,
  figma,
  gist,
  codesandbox,
  loom,
  codepen,
  spotify,
  excalidraw,
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

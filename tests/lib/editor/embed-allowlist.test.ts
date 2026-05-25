import { describe, expect, it } from 'vitest';
import { EMBED_FRAME_HOSTS, resolveEmbed } from '@/lib/editor/embed-allowlist';

describe('resolveEmbed — YouTube', () => {
  it('normalizes a watch URL to the embed URL', () => {
    const r = resolveEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(r).toEqual({ provider: 'youtube', src: 'https://www.youtube.com/embed/dQw4w9WgXcQ' });
  });
  it('normalizes a youtu.be short URL', () => {
    const r = resolveEmbed('https://youtu.be/dQw4w9WgXcQ');
    expect(r?.src).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
  });
  it('rejects a YouTube URL with no video id', () => {
    expect(resolveEmbed('https://www.youtube.com/feed/subscriptions')).toBeNull();
  });
});

describe('resolveEmbed — Vimeo', () => {
  it('normalizes a numeric video URL to player.vimeo.com', () => {
    const r = resolveEmbed('https://vimeo.com/76979871');
    expect(r).toEqual({ provider: 'vimeo', src: 'https://player.vimeo.com/video/76979871' });
  });
  it('rejects a non-numeric vimeo path', () => {
    expect(resolveEmbed('https://vimeo.com/channels/staffpicks')).toBeNull();
  });
});

describe('resolveEmbed — Figma / gist / CodeSandbox', () => {
  it('wraps a Figma file URL in the embed endpoint', () => {
    const r = resolveEmbed('https://www.figma.com/file/abc123/Design');
    expect(r?.provider).toBe('figma');
    expect(r?.src.startsWith('https://www.figma.com/embed?embed_host=cairn&url=')).toBe(true);
    expect(r?.src).toContain(encodeURIComponent('https://www.figma.com/file/abc123/Design'));
  });
  it('embeds a GitHub gist', () => {
    const r = resolveEmbed('https://gist.github.com/octocat/aa5a315d61ae9438b18d');
    expect(r?.provider).toBe('gist');
    expect(r?.src).toBe('https://gist.github.com/octocat/aa5a315d61ae9438b18d.pibb');
  });
  it('normalizes a CodeSandbox URL to the embed path', () => {
    const r = resolveEmbed('https://codesandbox.io/s/new-abc12');
    expect(r?.provider).toBe('codesandbox');
    expect(r?.src).toBe('https://codesandbox.io/embed/new-abc12');
  });
});

describe('resolveEmbed — refusals (allowlist-only)', () => {
  it('rejects an arbitrary origin', () => {
    expect(resolveEmbed('https://evil.example.com/iframe')).toBeNull();
  });
  it('rejects a non-https scheme', () => {
    expect(resolveEmbed('http://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
  it('rejects an unparseable URL', () => {
    expect(resolveEmbed('not a url')).toBeNull();
    expect(resolveEmbed('')).toBeNull();
  });
  it('rejects a javascript: payload', () => {
    expect(resolveEmbed('javascript:alert(1)')).toBeNull();
  });
});

describe('resolveEmbed — Loom', () => {
  it('normalizes a /share/ URL to the embed URL', () => {
    const r = resolveEmbed('https://www.loom.com/share/abcdef1234567890abcdef1234567890');
    expect(r?.provider).toBe('loom');
    expect(r?.src).toBe('https://www.loom.com/embed/abcdef1234567890abcdef1234567890');
  });
  it('accepts an already-embed URL', () => {
    const r = resolveEmbed('https://www.loom.com/embed/abcdef1234567890abcdef1234567890');
    expect(r?.src).toBe('https://www.loom.com/embed/abcdef1234567890abcdef1234567890');
  });
  it('rejects a non-loom host', () => {
    expect(resolveEmbed('https://evil.example.com/embed/abc')).toBeNull();
  });
});

describe('resolveEmbed — Codepen', () => {
  it('normalizes a /pen/ URL to the embed URL', () => {
    const r = resolveEmbed('https://codepen.io/octocat/pen/abcDEF');
    expect(r?.provider).toBe('codepen');
    expect(r?.src).toBe('https://codepen.io/octocat/embed/abcDEF');
  });
  it('accepts an already-embed URL', () => {
    const r = resolveEmbed('https://codepen.io/octocat/embed/abcDEF');
    expect(r?.src).toBe('https://codepen.io/octocat/embed/abcDEF');
  });
});

describe('resolveEmbed — Spotify', () => {
  it('normalizes a track URL to open.spotify.com/embed/track/<id>', () => {
    const r = resolveEmbed('https://open.spotify.com/track/abc123');
    expect(r?.provider).toBe('spotify');
    expect(r?.src).toBe('https://open.spotify.com/embed/track/abc123');
  });
  it('normalizes an album/playlist/episode/show URL', () => {
    expect(resolveEmbed('https://open.spotify.com/album/xyz')?.src).toBe(
      'https://open.spotify.com/embed/album/xyz',
    );
    expect(resolveEmbed('https://open.spotify.com/playlist/abc')?.src).toBe(
      'https://open.spotify.com/embed/playlist/abc',
    );
    expect(resolveEmbed('https://open.spotify.com/episode/def')?.src).toBe(
      'https://open.spotify.com/embed/episode/def',
    );
    expect(resolveEmbed('https://open.spotify.com/show/ghi')?.src).toBe(
      'https://open.spotify.com/embed/show/ghi',
    );
  });
  it('rejects an unknown resource type', () => {
    expect(resolveEmbed('https://open.spotify.com/artist/abc')).toBeNull();
  });
});

describe('resolveEmbed — Vimeo Showcase', () => {
  it('normalizes a showcase URL to the embed path', () => {
    const r = resolveEmbed('https://vimeo.com/showcase/1234567');
    expect(r?.provider).toBe('vimeoShowcase');
    expect(r?.src).toBe('https://vimeo.com/showcase/1234567/embed');
  });
  it('rejects a numeric vimeo path (those belong to the existing `vimeo` resolver)', () => {
    // The base `vimeo` resolver still handles plain /76979871 — make sure
    // showcase doesn't false-positive on that path.
    const r = resolveEmbed('https://vimeo.com/showcase/');
    expect(r).toBeNull();
  });
});

describe('resolveEmbed — Excalidraw', () => {
  it('normalizes a public room URL to the embed URL', () => {
    const r = resolveEmbed('https://excalidraw.com/#room=abc,def');
    expect(r?.provider).toBe('excalidraw');
    expect(r?.src).toBe('https://excalidraw.com/#room=abc,def');
  });
  it('accepts an already-embed URL', () => {
    const r = resolveEmbed('https://excalidraw.com/embed/?');
    expect(r?.src).toBe('https://excalidraw.com/embed/?');
  });
});

describe('resolveEmbed — refusals on bad schemes for the new providers', () => {
  it.each([
    'javascript:alert(1)',
    'http://www.loom.com/share/abcdef',
    'http://codepen.io/octocat/pen/abcDEF',
    'http://open.spotify.com/track/abc',
    'http://excalidraw.com/#room=abc,def',
  ])('rejects %s', (bad) => {
    expect(resolveEmbed(bad)).toBeNull();
  });
});

describe('EMBED_FRAME_HOSTS — extended set', () => {
  it('exposes all 10 allowed iframe origins (no Mermaid — it renders inline SVG)', () => {
    expect(EMBED_FRAME_HOSTS).toEqual([
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
    ]);
  });
});

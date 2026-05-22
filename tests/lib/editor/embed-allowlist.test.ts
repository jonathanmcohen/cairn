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

describe('EMBED_FRAME_HOSTS', () => {
  it('exposes the exact set of allowed iframe hosts for the CSP frame-src', () => {
    expect(EMBED_FRAME_HOSTS).toEqual([
      'https://www.youtube.com',
      'https://player.vimeo.com',
      'https://www.figma.com',
      'https://gist.github.com',
      'https://codesandbox.io',
    ]);
  });
});

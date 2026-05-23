import { describe, expect, it } from 'vitest';
import { parseOgTags } from '@/lib/editor/og-parse';

const BASE = 'https://example.com/articles/post';

describe('parseOgTags', () => {
  it('prefers Open-Graph tags', () => {
    const html = `
      <html><head>
        <title>Fallback Title</title>
        <meta property="og:title" content="OG Title" />
        <meta property="og:description" content="OG Desc" />
        <meta property="og:image" content="https://cdn.example.com/img.png" />
        <link rel="icon" href="/favicon.ico" />
      </head><body></body></html>`;
    expect(parseOgTags(html, BASE)).toEqual({
      title: 'OG Title',
      description: 'OG Desc',
      image: 'https://cdn.example.com/img.png',
      favicon: 'https://example.com/favicon.ico',
    });
  });

  it('falls back to <title> and meta description when no OG tags', () => {
    const html = `<head><title>Plain Title</title>
      <meta name="description" content="Plain Desc" /></head>`;
    const r = parseOgTags(html, BASE);
    expect(r.title).toBe('Plain Title');
    expect(r.description).toBe('Plain Desc');
    expect(r.image).toBeNull();
  });

  it('resolves a relative og:image against the base URL', () => {
    const html = `<head><meta property="og:image" content="/og/cover.jpg" /></head>`;
    expect(parseOgTags(html, BASE).image).toBe('https://example.com/og/cover.jpg');
  });

  it('defaults favicon to /favicon.ico when no icon link is present', () => {
    expect(parseOgTags('<head><title>x</title></head>', BASE).favicon).toBe(
      'https://example.com/favicon.ico',
    );
  });

  it('decodes HTML entities in extracted text', () => {
    const html = `<head><meta property="og:title" content="A &amp; B &#39;C&#39;" /></head>`;
    expect(parseOgTags(html, BASE).title).toBe("A & B 'C'");
  });

  it('returns nulls for an empty document', () => {
    expect(parseOgTags('', BASE)).toEqual({
      title: null,
      description: null,
      image: null,
      favicon: 'https://example.com/favicon.ico',
    });
  });
});

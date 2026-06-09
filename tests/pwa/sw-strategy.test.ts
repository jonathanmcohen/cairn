import { describe, expect, it } from 'vitest';
import { matchStrategy } from '@/lib/pwa/sw-strategy';

const url = (path: string) => new URL(`https://app.example.com${path}`);

describe('matchStrategy — security allow-list', () => {
  // SECURITY-CRITICAL: mutations are NEVER cached, regardless of path. The
  // network-only rule is listed and checked FIRST so no read rule can shadow it.
  it('network-only for all mutating methods regardless of path', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(matchStrategy(url('/api/pages/abc'), method)).toBe('network-only');
      expect(matchStrategy(url('/api/search'), method)).toBe('network-only');
      expect(matchStrategy(url('/pages/abc'), method)).toBe('network-only');
      expect(matchStrategy(url('/_next/static/chunk.js'), method)).toBe('network-only');
    }
  });

  it('network-only for auth routes (GET included)', () => {
    expect(matchStrategy(url('/api/auth/session'), 'GET')).toBe('network-only');
    expect(matchStrategy(url('/api/auth/callback/credentials'), 'POST')).toBe('network-only');
  });

  it('network-only for signed /api/files reads (GET included)', () => {
    expect(matchStrategy(url('/api/files/abc?sig=x&exp=1'), 'GET')).toBe('network-only');
  });

  it('network-only for the collab token/WS endpoint', () => {
    expect(matchStrategy(url('/api/collab'), 'GET')).toBe('network-only');
    expect(matchStrategy(new URL('wss://app.example.com/collab'), 'GET')).toBe('network-only');
  });

  it('network-first for /api GET reads (NOT URL-cached) — #143 workspace isolation', () => {
    // Cookie-scoped reads must never be served from a URL-keyed cache, or a
    // post-switch reload shows the previous workspace's data. Every one of
    // these is network-first so an online switch always re-fetches for the
    // active workspace; the per-URL cache is an offline fallback only.
    for (const path of [
      '/api/pages/abc',
      '/api/search?q=foo',
      '/api/search/saved',
      '/api/flashcards/due',
      '/api/workspace/pins',
      '/api/comments?pageId=abc',
      '/api/databases',
      '/api/favorites',
      '/api/inbox',
    ]) {
      expect(matchStrategy(url(path), 'GET')).toBe('network-first');
    }
  });

  it('network-first for navigations', () => {
    expect(matchStrategy(url('/pages/abc'), 'GET')).toBe('network-first');
    expect(matchStrategy(url('/'), 'GET')).toBe('network-first');
  });

  it('precache for /_next/static and static-ext assets', () => {
    expect(matchStrategy(url('/_next/static/chunk-abc.js'), 'GET')).toBe('precache');
    expect(matchStrategy(url('/icon-512.png'), 'GET')).toBe('precache');
  });
});

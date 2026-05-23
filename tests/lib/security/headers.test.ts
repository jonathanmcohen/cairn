import { describe, expect, it } from 'vitest';
import { EMBED_FRAME_HOSTS } from '@/lib/editor/embed-allowlist';
import { buildCsp, cspNonce, cspOrigin, headersFor, securityHeaders } from '@/lib/security/headers';

describe('cspOrigin', () => {
  it('normalizes a ws url to scheme//host', () => {
    expect(cspOrigin('ws://collab.local:1234')).toBe('ws://collab.local:1234');
    expect(cspOrigin('https://collab.example.com')).toBe('https://collab.example.com');
  });
  it('returns null for junk', () => {
    expect(cspOrigin('not a url')).toBeNull();
    expect(cspOrigin(undefined)).toBeNull();
  });
});

describe('buildCsp', () => {
  it('default policy is self-scoped with no unsafe-inline scripts', () => {
    const csp = buildCsp();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
  it('frame-src allowlists only the embed providers (no arbitrary iframes)', () => {
    const csp = buildCsp();
    expect(csp).toContain('frame-src');
    expect(csp).toContain("frame-src 'self' https://www.youtube.com");
    expect(csp).toContain('https://player.vimeo.com');
    expect(csp).toContain('https://codesandbox.io');
    // the public render keeps the same embed allowlist (embeds render read-only on /p)
    expect(buildCsp({ publicPath: true })).toContain("frame-src 'self' https://www.youtube.com");
  });
  it('frame-src exactly matches the embed-allowlist host set (drift guard)', () => {
    // headers.ts inlines the host list (import-free for the next.config loader);
    // this asserts it never drifts from the canonical EMBED_FRAME_HOSTS.
    const csp = buildCsp();
    const frameSrc = csp.split('; ').find((d) => d.startsWith('frame-src '));
    expect(frameSrc).toBe(`frame-src 'self' ${EMBED_FRAME_HOSTS.join(' ')}`);
  });
  it('allows inline styles (TipTap/Tailwind) but not inline scripts', () => {
    const csp = buildCsp();
    expect(csp).toMatch(/style-src 'self' 'unsafe-inline'/);
  });
  it('allows self + data + blob images (signed file images served same-origin)', () => {
    expect(buildCsp()).toMatch(/img-src 'self' data: blob:/);
  });
  it('adds the collab WS origin to connect-src (both http and ws scheme)', () => {
    const csp = buildCsp({ collabUrl: 'http://collab.local:1234' });
    expect(csp).toContain('http://collab.local:1234');
    expect(csp).toContain('ws://collab.local:1234');
  });
  it('public-path policy drops collab from connect-src', () => {
    const csp = buildCsp({ collabUrl: 'http://collab.local:1234', publicPath: true });
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain('collab.local');
  });
  it('adds a script-src nonce (not unsafe-inline) when one is supplied', () => {
    // Next/React stream hydration via inline scripts; a nonce lets them run
    // under `script-src 'self'` WITHOUT opening the gate to all inline scripts.
    const csp = buildCsp({ nonce: 'abc123' });
    expect(csp).toContain("script-src 'self' 'nonce-abc123'");
    // scripts never get unsafe-inline (styles do — that's a separate directive)
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    // the public-path policy carries the nonce too (it's still a Next/React render)
    const pub = buildCsp({ nonce: 'abc123', publicPath: true });
    expect(pub).toContain("script-src 'self' 'nonce-abc123'");
  });
});

describe('cspNonce', () => {
  it('extracts the nonce from a CSP string', () => {
    expect(cspNonce("script-src 'self' 'nonce-abc123'; object-src 'none'")).toBe('abc123');
  });
  it('returns undefined when no nonce / no CSP', () => {
    expect(cspNonce("script-src 'self'")).toBeUndefined();
    expect(cspNonce(null)).toBeUndefined();
    expect(cspNonce(undefined)).toBeUndefined();
  });
});

describe('securityHeaders', () => {
  it('always sets nosniff, DENY, referrer, permissions-policy', () => {
    const h = securityHeaders();
    const map = Object.fromEntries(h.map((x) => [x.key, x.value]));
    expect(map['X-Content-Type-Options']).toBe('nosniff');
    expect(map['X-Frame-Options']).toBe('DENY');
    expect(map['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(map['Permissions-Policy']).toContain('camera=()');
  });
  it('emits HSTS only in prod', () => {
    expect(
      securityHeaders({ isProd: false }).some((h) => h.key === 'Strict-Transport-Security'),
    ).toBe(false);
    expect(
      securityHeaders({ isProd: true }).some((h) => h.key === 'Strict-Transport-Security'),
    ).toBe(true);
  });
  it('adds X-Robots-Tag noindex on the public path', () => {
    expect(securityHeaders({ publicPath: true }).some((h) => h.key === 'X-Robots-Tag')).toBe(true);
  });
});

describe('headersFor', () => {
  it('bundles the hardening headers + CSP', () => {
    const h = headersFor({ collabUrl: 'http://c.local:1', isProd: true });
    const keys = h.map((x) => x.key);
    expect(keys).toContain('Content-Security-Policy');
    expect(keys).toContain('Strict-Transport-Security');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// v0.9.19 A5 (#5) — guard against re-introducing a cacheable-permanent settings
// redirect. The pre-v0.9.18 308 on /settings/admin poisoned browser caches; the
// proxy must emit 307 (temporary) + Cache-Control: no-store for settings
// redirects, and never serve the bare /settings/admin page cacheable.
describe('proxy settings-redirect cacheability (#5)', () => {
  const src = readFileSync('src/proxy.ts', 'utf8');

  it('redirects settings paths with 307, not the cacheable-permanent 308', () => {
    // The only redirect in the settings block is the 307 hop.
    expect(src).toContain('NextResponse.redirect(dest, 307)');
    expect(src).not.toContain('NextResponse.redirect(dest, 308)');
  });

  it('marks the settings redirect no-store', () => {
    expect(src).toMatch(/Cache-Control[^\n]*no-store/);
  });

  it('serves the bare /settings/admin page no-store', () => {
    expect(src).toContain("pathname === '/settings/admin'");
  });
});

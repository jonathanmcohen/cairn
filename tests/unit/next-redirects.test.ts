import { describe, expect, it } from 'vitest';
// next.config.mjs is plain JS (no .d.ts); type the imported shape locally so
// this test stays strict-clean.
// @ts-expect-error — no declaration file for the .mjs config; shape is asserted below.
import nextConfigUntyped from '../../next.config.mjs';

type RedirectRule = { source: string; destination: string; permanent: boolean };
type NextConfigShape = { redirects?: () => Promise<RedirectRule[]> };

const nextConfig = nextConfigUntyped as NextConfigShape;

describe('SSO route relocation redirects', () => {
  it('redirects every legacy /admin/sso* path to /settings/admin/sso*', async () => {
    expect(typeof nextConfig.redirects).toBe('function');
    const rules = await nextConfig.redirects!();
    const sso = rules.find((r) => r.source === '/admin/sso/:path*');
    expect(sso).toBeDefined();
    expect(sso?.destination).toBe('/settings/admin/sso/:path*');
    expect(sso?.permanent).toBe(true);

    const ssoRoot = rules.find((r) => r.source === '/admin/sso');
    expect(ssoRoot).toBeDefined();
    expect(ssoRoot?.destination).toBe('/settings/admin/sso');
    expect(ssoRoot?.permanent).toBe(true);
  });
});

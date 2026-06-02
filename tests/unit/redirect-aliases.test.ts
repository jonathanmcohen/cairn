import { describe, expect, it } from 'vitest';
// next.config.mjs is plain JS (no .d.ts); type the imported shape locally.
// @ts-expect-error — no declaration file for the .mjs config; shape asserted below.
import nextConfigUntyped from '../../next.config.mjs';

type RedirectRule = { source: string; destination: string; permanent: boolean };
type NextConfigShape = { redirects?: () => Promise<RedirectRule[]> };

const nextConfig = nextConfigUntyped as NextConfigShape;

describe('v0.9.9 A4 — settings URL aliases (#2/#3)', () => {
  it('aliases /trash-retention → /settings/workspace/trash (308)', async () => {
    const rules = await nextConfig.redirects!();
    const rule = rules.find((r) => r.source === '/trash-retention');
    expect(rule).toBeDefined();
    expect(rule?.destination).toBe('/settings/workspace/trash');
    expect(rule?.permanent).toBe(true);
  });

  it('aliases /access-tokens → /settings/developer/tokens (308)', async () => {
    const rules = await nextConfig.redirects!();
    const rule = rules.find((r) => r.source === '/access-tokens');
    expect(rule).toBeDefined();
    expect(rule?.destination).toBe('/settings/developer/tokens');
    expect(rule?.permanent).toBe(true);
  });

  it('keeps the prior SSO relocation aliases intact', async () => {
    const rules = await nextConfig.redirects!();
    expect(rules.some((r) => r.source === '/admin/sso/:path*')).toBe(true);
  });
});

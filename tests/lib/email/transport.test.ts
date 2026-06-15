import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectiveEmailConfig } from '@/lib/email/config';

// The transport reads the effective config from ./config; mock that so these
// stay pure unit tests (no DB). A null fake DB is fine — it's never touched.
let fakeConfig: EffectiveEmailConfig | null = null;
vi.mock('@/lib/email/config', () => ({
  getEffectiveEmailConfig: () => Promise.resolve(fakeConfig),
}));

const db = {} as never;

beforeEach(() => {
  vi.resetModules();
  fakeConfig = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('email transport (db-aware)', () => {
  it('is disabled (null transport) when no effective config', async () => {
    const mod = await import('@/lib/email/transport');
    mod.__resetTransport();
    expect(await mod.getTransport(db)).toBeNull();
    expect(await mod.emailEnabled(db)).toBe(false);
    expect(await mod.fromAddress(db)).toBe('cairn@localhost');
  });

  it('builds a transport from the effective config', async () => {
    fakeConfig = {
      host: 'smtp.example.com',
      port: 465,
      tlsMode: 'tls',
      user: 'mailer',
      pass: 'secret',
      from: 'noreply@example.com',
      replyTo: null,
      source: 'db',
    };
    const mod = await import('@/lib/email/transport');
    mod.__resetTransport();
    const t = await mod.getTransport(db);
    expect(t).not.toBeNull();
    expect(await mod.emailEnabled(db)).toBe(true);
    expect(await mod.fromAddress(db)).toBe('noreply@example.com');
  });
});

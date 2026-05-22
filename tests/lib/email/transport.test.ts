import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE = {
  DATABASE_URL: 'postgres://u:p@h:5432/d',
  AUTH_SECRET: 'x'.repeat(32),
  NEXTAUTH_URL: 'http://localhost:3000',
};

describe('email transport', () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...original, ...BASE };
    process.env.SMTP_HOST = undefined;
    process.env.SMTP_USER = undefined;
    process.env.SMTP_FROM = undefined;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('is disabled (null transport) when SMTP_HOST is unset', async () => {
    const mod = await import('@/lib/email/transport');
    mod.__resetTransport();
    expect(mod.getTransport()).toBeNull();
    expect(mod.emailEnabled()).toBe(false);
  });

  it('builds a transport when SMTP_HOST is set', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'mailer';
    process.env.SMTP_PASS = 'secret';
    const mod = await import('@/lib/email/transport');
    mod.__resetTransport();
    const t = mod.getTransport();
    expect(t).not.toBeNull();
    expect(mod.emailEnabled()).toBe(true);
  });

  it('fromAddress prefers SMTP_FROM, then SMTP_USER, then default', async () => {
    process.env.SMTP_USER = 'mailer@example.com';
    process.env.SMTP_FROM = 'noreply@example.com';
    const mod = await import('@/lib/email/transport');
    expect(mod.fromAddress()).toBe('noreply@example.com');

    vi.resetModules();
    process.env.SMTP_FROM = undefined;
    process.env.SMTP_USER = 'mailer@example.com';
    const mod2 = await import('@/lib/email/transport');
    expect(mod2.fromAddress()).toBe('mailer@example.com');
  });
});

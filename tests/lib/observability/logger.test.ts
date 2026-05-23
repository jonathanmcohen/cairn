import { describe, expect, it } from 'vitest';
import { createTestLogger, REDACT_PATHS } from '@/lib/observability/logger';

function capture() {
  const lines: string[] = [];
  const logger = createTestLogger((line) => lines.push(line));
  return { logger, lines };
}

describe('pino logger redaction', () => {
  it('redacts every declared secret field', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        user: { passwordHash: 'argon2-hash-here' },
        apiKey: { tokenHash: 'sha256hash' },
        webhook: { secret: 'whsec_abc' },
        totp: { secret_encrypted: 'AESGCMBYTES', recovery_codes: ['c1', 'c2'] },
        authorization: 'Bearer cairn_sk_deadbeef',
        cookie: 'cairn_session=xyz',
        AUTH_SECRET: 'the-app-signing-secret',
        CAIRN_METRICS_TOKEN: 'metrics-token-value',
        signedUrl: { sig: 'abcd1234' },
      },
      'sensitive event',
    );
    const out = lines.join('\n');
    for (const leaked of [
      'argon2-hash-here',
      'sha256hash',
      'whsec_abc',
      'AESGCMBYTES',
      'cairn_sk_deadbeef',
      'cairn_session=xyz',
      'the-app-signing-secret',
      'metrics-token-value',
      'abcd1234',
    ]) {
      expect(out, `leaked secret value: ${leaked}`).not.toContain(leaked);
    }
    expect(out).not.toContain('"c1"');
    expect(out).toContain('[Redacted]');
    expect(out).toContain('sensitive event');
  });

  it('the redaction path list covers the known secret classes', () => {
    for (const needle of [
      'passwordHash',
      'tokenHash',
      'secret',
      'secret_encrypted',
      'recovery_codes',
      'authorization',
      'cookie',
      'AUTH_SECRET',
      'CAIRN_METRICS_TOKEN',
      'sig',
    ]) {
      expect(REDACT_PATHS.some((p) => p.includes(needle))).toBe(true);
    }
  });
});

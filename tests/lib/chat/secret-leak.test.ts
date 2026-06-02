/**
 * v0.9.0 G7 P37 — defense-in-depth: per-install secrets (bot_token /
 * signing_secret) MUST be redacted by the pino sink even when a stray
 * log call interpolates an install object.
 */
import { describe, expect, it } from 'vitest';
import { createTestLogger } from '@/lib/observability/logger';

describe('chat-bridge secret redaction', () => {
  it('redacts botToken (camelCase) and bot_token (snake_case) anywhere in the payload', () => {
    const lines: string[] = [];
    const log = createTestLogger((line) => lines.push(line));
    log.info({
      install: {
        id: 'i1',
        botToken: 'xoxb-test-secret-token',
        signingSecret: 'test-signing-secret',
      },
      raw: { bot_token: 'xoxb-snake', signing_secret: 'snake-signing' },
    });
    const all = lines.join('\n');
    expect(all).not.toContain('xoxb-test-secret-token');
    expect(all).not.toContain('test-signing-secret');
    expect(all).not.toContain('xoxb-snake');
    expect(all).not.toContain('snake-signing');
    expect(all).toContain('[Redacted]');
  });

  it('redacts OAuth access_token / accessToken anywhere in the payload', () => {
    const lines: string[] = [];
    const log = createTestLogger((line) => lines.push(line));
    log.info({
      exchange: { accessToken: 'xoxb-oauth-secret', externalTeamId: 'T1', platform: 'slack' },
      raw: { access_token: 'disc-oauth-secret' },
    });
    const all = lines.join('\n');
    expect(all).not.toContain('xoxb-oauth-secret');
    expect(all).not.toContain('disc-oauth-secret');
    expect(all).toContain('T1');
    expect(all).toContain('[Redacted]');
  });

  it('still emits non-secret fields verbatim', () => {
    const lines: string[] = [];
    const log = createTestLogger((line) => lines.push(line));
    log.info({ install: { id: 'visible-id', platform: 'slack' } });
    expect(lines.join('\n')).toContain('visible-id');
    expect(lines.join('\n')).toContain('slack');
  });
});

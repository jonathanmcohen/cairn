import { describe, expect, it } from 'vitest';
import { openBotToken, sealBotToken } from '@/lib/chat/oauth-token';

describe('chat oauth bot-token sealing', () => {
  const SECRET = 'x'.repeat(32);

  it('round-trips a bot token through seal/open', () => {
    const sealed = sealBotToken('xoxb-real-token', SECRET);
    expect(Buffer.isBuffer(sealed)).toBe(true);
    expect(sealed.toString('utf8')).not.toContain('xoxb-real-token');
    expect(openBotToken(sealed, SECRET)).toBe('xoxb-real-token');
  });

  it('throws when opened with the wrong key', () => {
    const sealed = sealBotToken('xoxb-real-token', SECRET);
    expect(() => openBotToken(sealed, 'y'.repeat(32))).toThrow();
  });

  it('rejects an AUTH_SECRET shorter than 32 chars', () => {
    expect(() => sealBotToken('t', 'short')).toThrow(/AUTH_SECRET/);
  });
});

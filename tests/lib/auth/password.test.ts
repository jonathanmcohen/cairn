import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects wrong passwords', async () => {
    const hash = await hashPassword('correct password here');
    expect(await verifyPassword('wrong password here!!', hash)).toBe(false);
  });

  it('rejects passwords shorter than 12 chars at hash time', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least 12/);
  });
});

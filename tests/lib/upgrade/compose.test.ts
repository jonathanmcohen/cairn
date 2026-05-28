import { describe, expect, it } from 'vitest';
import { applyViaCompose } from '@/lib/upgrade/compose';

describe('applyViaCompose', () => {
  it('runs stop -> dump -> pull -> up -> health in order', async () => {
    const calls: string[] = [];
    const result = await applyViaCompose({
      databaseUrl: 'postgres://test/cairn',
      backupDir: '/tmp/x',
      fromVersion: '0.8.0',
      toVersion: '0.9.0',
      dockerCompose: async (args) => {
        calls.push(args.join(' '));
        return { ok: true };
      },
      dump: async () => {
        calls.push('dump');
        return { path: '/tmp/x/snap.sql.gz', bytesWritten: 1 };
      },
      healthcheck: async () => {
        calls.push('health');
        return { ok: true, drift: false };
      },
      restore: async () => {},
      healthcheckPollDelayMs: 0,
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['stop cairn cairn-collab', 'dump', 'pull', 'up -d', 'health']);
  });

  it('restores snapshot when healthcheck fails after up', async () => {
    let restored = false;
    const result = await applyViaCompose({
      databaseUrl: 'postgres://test/cairn',
      backupDir: '/tmp/x',
      fromVersion: '0.8.0',
      toVersion: '0.9.0',
      dockerCompose: async () => ({ ok: true }),
      dump: async () => ({ path: '/tmp/x/snap.sql.gz', bytesWritten: 1 }),
      healthcheck: async () => ({ ok: false, drift: false, reason: 'timeout' }),
      restore: async () => {
        restored = true;
      },
      healthcheckTimeoutMs: 50,
      healthcheckPollDelayMs: 5,
    });
    expect(result.ok).toBe(false);
    expect(restored).toBe(true);
  });
});

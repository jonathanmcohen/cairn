/**
 * v0.10.0 D4 — getHealthSnapshot probe-failure tolerance.
 *
 * Layer split with tests/e2e/item-D4-health-panel.spec.ts: the e2e harness
 * can't take its own Postgres down mid-run (it would kill every later spec),
 * so the DEGRADED paths are proven here with injected failing probes — the lib
 * is designed for injection precisely so 'down'/'unreachable' are testable
 * without real outages. The healthy path against live infra is e2e-covered.
 */
import { describe, expect, it, vi } from 'vitest';
import { getHealthSnapshot, type HealthProbes } from '@/lib/health/panel';

function healthyProbes(): HealthProbes {
  return {
    dbPing: vi.fn(async () => {}),
    readVersion: vi.fn(async () => '1.2.3'),
    uptimeSeconds: vi.fn(() => 42.9),
    collabConfigured: vi.fn(() => true),
    collabPing: vi.fn(async () => {}),
  };
}

describe('getHealthSnapshot', () => {
  it('healthy probes → up/connected snapshot with floored uptime', async () => {
    const snap = await getHealthSnapshot(healthyProbes());
    expect(snap).toEqual({
      db: 'up',
      version: '1.2.3',
      uptimeSeconds: 42,
      collabBridge: 'connected',
    });
  });

  it('db probe rejection becomes db: "down" — never a throw', async () => {
    const probes = healthyProbes();
    probes.dbPing = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const snap = await getHealthSnapshot(probes);
    expect(snap.db).toBe('down');
    // The other fields still populate: one broken probe can't blank the panel.
    expect(snap.version).toBe('1.2.3');
    expect(snap.collabBridge).toBe('connected');
  });

  it('collab ping timeout/rejection becomes "unreachable" — never a throw', async () => {
    const probes = healthyProbes();
    probes.collabPing = vi.fn(async () => {
      throw new Error('aborted (timeout)');
    });
    const snap = await getHealthSnapshot(probes);
    expect(snap.collabBridge).toBe('unreachable');
    expect(snap.db).toBe('up');
  });

  it('collab bridge env unset → "unconfigured" and the ping is never attempted', async () => {
    const probes = healthyProbes();
    probes.collabConfigured = vi.fn(() => false);
    const snap = await getHealthSnapshot(probes);
    expect(snap.collabBridge).toBe('unconfigured');
    expect(probes.collabPing).not.toHaveBeenCalled();
  });

  it('version probe failure degrades to "unknown"', async () => {
    const probes = healthyProbes();
    probes.readVersion = vi.fn(async () => {
      throw new Error('ENOENT');
    });
    const snap = await getHealthSnapshot(probes);
    expect(snap.version).toBe('unknown');
    expect(snap.db).toBe('up');
  });

  it('every probe failing at once still resolves to a full snapshot', async () => {
    const boom = async () => {
      throw new Error('boom');
    };
    const snap = await getHealthSnapshot({
      dbPing: boom,
      readVersion: boom,
      uptimeSeconds: () => {
        throw new Error('boom');
      },
      collabConfigured: () => {
        throw new Error('boom');
      },
      collabPing: boom,
    });
    expect(snap).toEqual({
      db: 'down',
      version: 'unknown',
      uptimeSeconds: 0,
      collabBridge: 'unconfigured',
    });
  });
});

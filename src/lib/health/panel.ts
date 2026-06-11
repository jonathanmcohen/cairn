import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { isCollabBridgeConfigured } from '@/lib/collab/publish-client';
import { readPackageVersion } from '@/lib/upgrade/version';

/**
 * v0.10.0 D4 — server-side aggregation for the admin health panel
 * (/settings/admin/health).
 *
 * WHY a panel at all: `GET /api/health` ALWAYS answers HTTP 200 and reports
 * its real state in the BODY only (`db: 'ok' | 'down'`) — a load balancer
 * keyed on the status code never sheds a broken replica through that route.
 * `/healthz` (503 on db-down) is the machine probe; this panel is the HUMAN
 * surface, so an operator can see the same signals without curl. D4 only
 * READS — whether /api/health's status-code contract changes belongs to H4d.
 *
 * CONTRACT: getHealthSnapshot NEVER throws. Every probe failure becomes a
 * field state ('down' / 'unreachable' / 'unknown') so one broken dependency
 * can't blank the whole panel. Probes are injectable so the failure paths are
 * unit-testable without taking real infrastructure down
 * (tests/lib/health-panel.test.ts).
 */

export type DbState = 'up' | 'down';
export type CollabBridgeState = 'unconfigured' | 'connected' | 'unreachable';

export type HealthSnapshot = {
  db: DbState;
  /** Bundled package.json#version — same source /healthz reports. */
  version: string;
  /**
   * process.uptime() of THIS server process. Multi-replica honesty rule: the
   * UI must label it per-replica — behind a load balancer each replica has
   * its own uptime and the panel only sees the one that served the request.
   */
  uptimeSeconds: number;
  collabBridge: CollabBridgeState;
};

export type HealthProbes = {
  /** Cheap DB touch; reject = down. Default: the same SELECT 1 /healthz runs. */
  dbPing: () => Promise<void>;
  readVersion: () => Promise<string>;
  uptimeSeconds: () => number;
  /** Is the REST→Yjs bridge configured (env present)? Default: A4's gate. */
  collabConfigured: () => boolean;
  /**
   * Reachability ping against the collab internal control plane (the same
   * base URL publishContentToCollab POSTs to). Reject = unreachable.
   */
  collabPing: () => Promise<void>;
};

/** Bound the reachability ping so a hung collab process can't stall the RSC. */
const COLLAB_PING_TIMEOUT_MS = 1500;

async function defaultCollabPing(): Promise<void> {
  const baseUrl = process.env.CAIRN_COLLAB_INTERNAL_URL;
  if (!baseUrl) throw new Error('collab bridge not configured');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), COLLAB_PING_TIMEOUT_MS);
  try {
    // Any HTTP response proves the process is up and listening — the
    // Hocuspocus default handler answers GET / with a 2xx welcome body, and
    // even a 4xx would mean "reachable". Only a network error/timeout rejects.
    await fetch(baseUrl, { method: 'GET', signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_PROBES: HealthProbes = {
  dbPing: async () => {
    await getDb().execute(sql`SELECT 1`);
  },
  readVersion: readPackageVersion,
  uptimeSeconds: () => process.uptime(),
  collabConfigured: isCollabBridgeConfigured,
  collabPing: defaultCollabPing,
};

export async function getHealthSnapshot(
  overrides: Partial<HealthProbes> = {},
): Promise<HealthSnapshot> {
  const probes: HealthProbes = { ...DEFAULT_PROBES, ...overrides };

  let db: DbState = 'down';
  try {
    await probes.dbPing();
    db = 'up';
  } catch {
    db = 'down';
  }

  let version = 'unknown';
  try {
    version = await probes.readVersion();
  } catch {
    version = 'unknown';
  }

  let uptimeSeconds = 0;
  try {
    uptimeSeconds = Math.max(0, Math.floor(probes.uptimeSeconds()));
  } catch {
    uptimeSeconds = 0;
  }

  let collabBridge: CollabBridgeState = 'unconfigured';
  try {
    if (probes.collabConfigured()) {
      try {
        await probes.collabPing();
        collabBridge = 'connected';
      } catch {
        collabBridge = 'unreachable';
      }
    }
  } catch {
    collabBridge = 'unconfigured';
  }

  return { db, version, uptimeSeconds, collabBridge };
}

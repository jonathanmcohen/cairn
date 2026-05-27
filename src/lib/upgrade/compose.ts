import { spawn } from 'node:child_process';

export type ComposeApplyInput = {
  databaseUrl: string;
  backupDir: string;
  fromVersion: string;
  toVersion: string;
  dockerCompose?: (args: string[]) => Promise<{ ok: boolean; stderr?: string }>;
  dump?: (databaseUrl: string, outDir: string) => Promise<{ path: string; bytesWritten: number }>;
  healthcheck?: () => Promise<{ ok: boolean; drift: boolean; reason?: string }>;
  restore?: (databaseUrl: string, dumpPath: string) => Promise<void>;
  healthcheckTimeoutMs?: number;
  /** Initial poll delay (ms). Defaults to 2000; tests override to 0. */
  healthcheckPollDelayMs?: number;
};

export type ComposeApplyResult = { ok: boolean; snapshotPath?: string; error?: string };

/**
 * docker-compose orchestration wrapper. Sequence:
 *   stop cairn cairn-collab -> dump -> pull -> up -d -> health (poll).
 * Restores the snapshot on `up` failure or healthcheck timeout.
 */
export async function applyViaCompose(input: ComposeApplyInput): Promise<ComposeApplyResult> {
  const compose = input.dockerCompose ?? defaultDockerCompose;
  const dump =
    input.dump ??
    (async (u, d) => (await import('./snapshot.js')).dumpDatabase({ databaseUrl: u, outDir: d }));
  const health =
    input.healthcheck ??
    (async () =>
      (await import('./healthcheck.js')).runHealthcheck({ databaseUrl: input.databaseUrl }));
  const restore =
    input.restore ??
    (async (u, p) =>
      (await import('./snapshot.js')).restoreDatabase({ databaseUrl: u, dumpPath: p }));

  const stop = await compose(['stop', 'cairn', 'cairn-collab']);
  if (!stop.ok) return { ok: false, error: `compose stop: ${stop.stderr ?? ''}` };

  const snap = await dump(input.databaseUrl, input.backupDir);

  const pull = await compose(['pull']);
  if (!pull.ok)
    return { ok: false, snapshotPath: snap.path, error: `compose pull: ${pull.stderr ?? ''}` };

  const up = await compose(['up', '-d']);
  if (!up.ok) {
    await restore(input.databaseUrl, snap.path).catch(() => {});
    return { ok: false, snapshotPath: snap.path, error: `compose up: ${up.stderr ?? ''}` };
  }

  const pollDelay = input.healthcheckPollDelayMs ?? 2000;
  const deadline = Date.now() + (input.healthcheckTimeoutMs ?? 120_000);
  let last = await health();
  while (!last.ok && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollDelay));
    last = await health();
  }
  if (!last.ok) {
    await restore(input.databaseUrl, snap.path).catch(() => {});
    return {
      ok: false,
      snapshotPath: snap.path,
      error: `healthcheck: ${last.reason ?? 'unknown'}`,
    };
  }
  return { ok: true, snapshotPath: snap.path };
}

async function defaultDockerCompose(args: string[]): Promise<{ ok: boolean; stderr?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['compose', ...args], { stdio: ['ignore', 'inherit', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    proc.on('exit', (code) => resolve({ ok: code === 0, stderr }));
    proc.on('error', () => resolve({ ok: false, stderr }));
  });
}

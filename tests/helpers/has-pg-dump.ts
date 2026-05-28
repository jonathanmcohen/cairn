/**
 * Synchronous probe for `pg_dump` on PATH.
 *
 * Used by upgrade-suite tests (snapshot / apply / preview) to skip when
 * the runner lacks postgresql-client. Local dev boxes without
 * `libpq`/`postgresql-client` installed, and self-hosted CI runners that
 * haven't been provisioned with the client tools, both hit
 * `spawn pg_dump ENOENT`. CI image install lives outside the repo, so
 * we skip rather than fail.
 *
 * `describe.skipIf(!hasPgDump)` is evaluated at module-load time which
 * matches the way tests/security/api-keys.test.ts gates on env-derived
 * conditions — keep the probe synchronous.
 */

import { spawnSync } from 'node:child_process';

function probe(): boolean {
  try {
    const res = spawnSync('pg_dump', ['--version'], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
}

export const hasPgDump = probe();

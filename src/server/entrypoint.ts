import { runMigrations } from '../db/migrate.js';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  // biome-ignore lint/suspicious/noConsole: cli startup
  console.log('Running migrations...');
  await runMigrations(url);
  // biome-ignore lint/suspicious/noConsole: cli startup
  console.log('Migrations complete.');

  // MFA / WebAuthn RP-ID sanity check (v0.9.0 G1 P8, retro §3 risk #5).
  // Mismatch between CAIRN_RP_ORIGIN and NEXTAUTH_URL invalidates every enrolled
  // credential permanently — detect early and warn loudly. Don't crash (admins
  // may run a tooling-only image without NEXTAUTH_URL set), but log a
  // structured warning the operator will see in every container start.
  try {
    const rpOriginRaw = process.env.CAIRN_RP_ORIGIN;
    const nextRaw = process.env.NEXTAUTH_URL;
    if (rpOriginRaw && nextRaw) {
      const rpOrigin = new URL(rpOriginRaw);
      const next = new URL(nextRaw);
      if (rpOrigin.origin !== next.origin) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            msg: 'CAIRN_RP_ORIGIN does not match NEXTAUTH_URL origin — WebAuthn registrations will be incompatible across these URLs',
            rpOrigin: rpOrigin.origin,
            nextAuthOrigin: next.origin,
          }),
        );
      }
    }
  } catch {
    // Either env var missing or unparseable — leave validation to runtime env() callers.
  }

  // v0.9.19 A4 (#A3) — the REST→Yjs publish bridge is OFF unless
  // CAIRN_COLLAB_INTERNAL_URL is set (and AUTH_SECRET, which credentials auth
  // already requires). When OFF, a REST PATCH to a page's content updates the
  // DB but never reaches an open editor session — the v0.9.18 live miss.
  // Deployments on an old docker-compose silently ran without it; warn loudly
  // at every boot so the operator sees the misconfiguration. (Inlined, not
  // imported: the entrypoint stays a relative-import-only ESM orchestrator.)
  if (!process.env.CAIRN_COLLAB_INTERNAL_URL) {
    console.warn(
      '[collab] API↔Yjs bridge is DISABLED — set CAIRN_COLLAB_INTERNAL_URL in env to enable; PATCH /api/v1/pages/:id will only update DB, not live editor.',
    );
  }

  // NOTE: the webhook startup sweep (recovering pending/failed deliveries left
  // by a previous process) runs from `src/instrumentation.ts#register()` inside
  // the Next app, NOT here. The entrypoint stays a minimal ESM orchestrator with
  // only relative imports — pulling the `@/`-aliased webhook/db graph in here
  // breaks `node dist/server/entrypoint.js` at runtime (no path-map resolution).

  // Hand off to the standalone Next.js server (lives at /app/server.js in the runner image).
  // Path is resolved at runtime from /app/dist/server/entrypoint.js → /app/server.js.
  const standaloneServer = '../../server.js';
  await import(standaloneServer);
}

main().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});

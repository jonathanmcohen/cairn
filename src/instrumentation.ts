/**
 * Next.js instrumentation hook — runs once when the server process boots,
 * inside the fully-resolved app module graph (so `@/` imports work, unlike the
 * minimal `src/server/entrypoint.ts` orchestrator).
 *
 * We use it to recover webhook deliveries left `pending`/`failed` by a previous
 * process: in-process dispatch schedules retries with `setImmediate`, which are
 * lost on restart. The sweep re-schedules them. Non-blocking and node-only.
 *
 * It also seeds the global built-in templates (idempotent, keyed by name) so
 * they exist before the first request. This lives here — not in the minimal
 * `src/server/entrypoint.ts` orchestrator — because seeding pulls in the
 * `@/`-aliased templates/db graph, which only resolves inside the Next app.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { sweepPendingDeliveries } = await import('@/lib/webhooks/sweep');
  void sweepPendingDeliveries()
    .then((n) => {
      if (n > 0) {
        // biome-ignore lint/suspicious/noConsole: server startup
        console.log(`[webhooks] re-scheduled ${n} pending/failed deliveries`);
      }
    })
    .catch((err) => {
      console.error('[webhooks] startup sweep failed', err);
    });

  const [{ seedBuiltinTemplates }, { getDb }] = await Promise.all([
    import('@/lib/templates/builtins'),
    import('@/db/client'),
  ]);
  void seedBuiltinTemplates(getDb())
    .then(() => {
      // biome-ignore lint/suspicious/noConsole: server startup
      console.log('[templates] built-in templates seeded');
    })
    .catch((err) => {
      console.error('[templates] startup seed failed', err);
    });

  const { env } = await import('@/lib/env');
  const interval = env().CAIRN_DIGEST_INTERVAL;
  if (interval > 0) {
    const { scanDigests } = await import('@/lib/email/digest');
    setInterval(() => {
      void scanDigests(getDb()).catch(() => {});
    }, interval * 60_000);
    // biome-ignore lint/suspicious/noConsole: server startup
    console.log(`[email] digest ticker every ${interval}m (single-instance only)`);
  }

  // Opt-in one-time embedding backfill (v0.7.0 G4 P12).
  // SINGLE-INSTANCE only — two app processes both run their own pass and
  // double-bill the embedding provider. Prefer `pnpm cli reindex-embeddings`
  // from a one-shot container in multi-instance deployments. Documented in
  // docs/operations.md ("Embedding backfill").
  if (process.env.CAIRN_BACKFILL_EMBEDDINGS === '1') {
    setImmediate(() => {
      void (async () => {
        try {
          const { reindexEmbeddings } = await import('@/lib/search/reindex-cli');
          const summary = await reindexEmbeddings(getDb(), {});
          // biome-ignore lint/suspicious/noConsole: server startup
          console.log(`[backfill-embeddings] ${JSON.stringify(summary)}`);
        } catch (err) {
          console.warn('[backfill-embeddings] failed:', err);
        }
      })();
    });
  }
}

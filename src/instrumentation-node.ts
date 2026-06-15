/**
 * Node-only startup side effects for the Next.js instrumentation hook.
 *
 * Split out of `src/instrumentation.ts` so the Node-only APIs used here
 * (`process.on`, `setImmediate`, `setInterval`) never appear in the module
 * graph that Next's Edge-runtime build pass statically analyzes. `register()`
 * in instrumentation.ts only `await import()`s this file inside the
 * `NEXT_RUNTIME === 'nodejs'` guard, so the Edge bundle never references it and
 * the "A Node.js API is used ... not supported in the Edge Runtime" build
 * warnings stay silent. A runtime guard alone is insufficient — Next flags the
 * APIs at build time from the text, regardless of whether the guard prevents
 * their execution.
 */
export async function registerNode(): Promise<void> {
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

  // v0.10.3 CFG-1 — first-boot migrate of SMTP_* env into the DB-backed
  // instance_email_config row, so the admin sees today's values in the UI.
  // Idempotent: no-op once a row exists or when no SMTP host is set.
  const { migrateEnvEmailConfigOnce } = await import('@/lib/email/config');
  void migrateEnvEmailConfigOnce(getDb())
    .then((migrated) => {
      if (migrated) {
        // biome-ignore lint/suspicious/noConsole: server startup
        console.log('[email] migrated SMTP_* env into instance_email_config');
      }
    })
    .catch((err) => {
      console.error('[email] env→DB email-config migration failed', err);
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

  // Opt-in cron-schedules driver (v0.7.0 G5 P14). SINGLE-INSTANCE only —
  // two app processes both poll cron_schedules and double-fire each due row.
  // Disable in multi-instance deployments and drive recurring CLI work from
  // external cron / Kubernetes CronJob. Documented in docs/operations.md
  // ("Cron-driven CLI scheduler").
  if (process.env.CAIRN_SCHEDULER_ENABLED === '1') {
    const { startScheduler } = await import('@/server/scheduler');
    const handle = startScheduler({ db: getDb() });
    // biome-ignore lint/suspicious/noConsole: server startup
    console.log('[scheduler] cron_schedules driver enabled (single-instance only)');
    const stop = () => {
      void handle.stop();
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);

    // v0.9.0 G2 P14 — register the global pages:auto-unlock cron row (every 5
    // minutes). Tied to the scheduler enable-flag because the schedule is
    // useless without a process to consume it.
    const { registerPageAutoUnlockCron, registerFlashcardsNotifyDueCron } = await import(
      '@/server/cron-register'
    );
    void registerPageAutoUnlockCron(getDb())
      .then(() => {
        // biome-ignore lint/suspicious/noConsole: server startup
        console.log('[pages] auto-unlock cron registered (*/5 * * * *)');
      })
      .catch((err) => {
        console.error('[pages] auto-unlock cron registration failed', err);
      });

    // v0.9.0 G3 P19 — register the global flashcards:notify-due cron row
    // (daily at 09:00 UTC). Same scheduler-flag gating.
    void registerFlashcardsNotifyDueCron(getDb())
      .then(() => {
        // biome-ignore lint/suspicious/noConsole: server startup
        console.log('[flashcards] notify-due cron registered (0 9 * * *)');
      })
      .catch((err) => {
        console.error('[flashcards] notify-due cron registration failed', err);
      });

    // v0.9.0 G8 P39 — register the global siem:retry-sweep cron row
    // (every minute). The sweep is a no-op when the delivery log is clean.
    const { registerSiemRetrySweepCron, registerSiemDailyArchiveCron } = await import(
      '@/server/cron-register'
    );
    void registerSiemRetrySweepCron(getDb())
      .then(() => {
        // biome-ignore lint/suspicious/noConsole: server startup
        console.log('[siem] retry-sweep cron registered (* * * * *)');
      })
      .catch((err) => {
        console.error('[siem] retry-sweep cron registration failed', err);
      });

    // v0.9.0 G8 P40 — register the global siem:daily-archive cron row
    // (daily at 01:15 UTC). Iterates every enabled kind=s3 forwarder and
    // archives yesterday's audit_log rows. Empty days are a no-op.
    void registerSiemDailyArchiveCron(getDb())
      .then(() => {
        // biome-ignore lint/suspicious/noConsole: server startup
        console.log('[siem] daily-archive cron registered (15 1 * * *)');
      })
      .catch((err) => {
        console.error('[siem] daily-archive cron registration failed', err);
      });

    // v0.9.0 G8 P42 — register the global release-watch:tick cron row
    // (daily at 04:30 UTC). Polls CAIRN_RELEASE_FEED_URL and notifies
    // every admin/owner when a newer stable tag ships. Gated by
    // CAIRN_RELEASE_WATCH_ENABLED so air-gapped deploys can opt out.
    // Auto-apply remains OFF; the admin button at /settings/admin/upgrade
    // is the only path to `applyUpgrade`.
    if (env().CAIRN_RELEASE_WATCH_ENABLED) {
      const { registerReleaseWatchTickCron } = await import('@/server/cron-register');
      void registerReleaseWatchTickCron(getDb())
        .then(() => {
          // biome-ignore lint/suspicious/noConsole: server startup
          console.log('[release-watch] tick cron registered (30 4 * * *)');
        })
        .catch((err) => {
          console.error('[release-watch] tick cron registration failed', err);
        });
    }
  }
}

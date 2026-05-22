/**
 * Next.js instrumentation hook — runs once when the server process boots,
 * inside the fully-resolved app module graph (so `@/` imports work, unlike the
 * minimal `src/server/entrypoint.ts` orchestrator).
 *
 * We use it to recover webhook deliveries left `pending`/`failed` by a previous
 * process: in-process dispatch schedules retries with `setImmediate`, which are
 * lost on restart. The sweep re-schedules them. Non-blocking and node-only.
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
}

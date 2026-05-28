/**
 * Next.js instrumentation hook — runs once when the server process boots,
 * inside the fully-resolved app module graph (so `@/` imports work, unlike the
 * minimal `src/server/entrypoint.ts` orchestrator).
 *
 * The actual startup work (webhook-delivery recovery, built-in template seed,
 * digest ticker, opt-in embedding backfill, cron-schedules driver) lives in
 * `./instrumentation-node`. It uses Node-only APIs (`process.on`,
 * `setImmediate`, `setInterval`) and is reached only via a dynamic
 * `import()` inside the `NEXT_RUNTIME === 'nodejs'` guard below — so Next's
 * Edge-runtime build pass never statically analyzes those APIs and the
 * "A Node.js API is used ... not supported in the Edge Runtime" build
 * warnings stay silent. (A plain runtime guard with the code inlined here is
 * not enough: Next flags the APIs at build time from the module text.)
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { registerNode } = await import('./instrumentation-node');
  await registerNode();
}

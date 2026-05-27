/**
 * v0.9.0 G8 P39 — Generic HTTP webhook target.
 *
 * POSTs the JSON-serialized envelope to `forwarder.endpoint`. If a
 * `credentialSecret` is set the request carries an `Authorization: Bearer`
 * header (this covers the common Splunk HEC / Datadog Logs / generic
 * collector shape; the bespoke per-platform headers land in P40).
 *
 * 4xx/5xx responses throw — the dispatcher catches the throw and persists a
 * `retry` row for the cron sweep. A `timeoutMs` option (default 5s) clamps
 * any single attempt so a black-holed endpoint cannot stall the dispatcher.
 *
 * Never log `credentialSecret` directly; the central REDACT_PATHS list scrubs
 * `authorization` / `*.authorization` so an accidental headers-dump can't leak it.
 */

import type { SiemEnvelope } from '../format';

export async function sendHttp(
  forwarder: { endpoint: string; credentialSecret: string | null; options: Record<string, unknown> },
  env: SiemEnvelope,
): Promise<void> {
  const timeoutMs = (forwarder.options.timeoutMs as number | undefined) ?? 5_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (forwarder.credentialSecret) {
      headers.authorization = `Bearer ${forwarder.credentialSecret}`;
    }
    const res = await fetch(forwarder.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(env),
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

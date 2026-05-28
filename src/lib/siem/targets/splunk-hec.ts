/**
 * v0.9.0 G8 P40 — Splunk HTTP Event Collector (HEC) target.
 *
 * POSTs each audit envelope to `<endpoint>/services/collector` (override via
 * `options.path`) with the Splunk-flavoured wrapper
 * `{event, source, sourcetype, host, time}` and an `Authorization: Splunk
 * <token>` header. The HEC token is required — we reject misconfig early so
 * the dispatcher's retry-row carries a clear error instead of a 401 storm
 * against the operator's collector.
 *
 * Error surface intentionally stays terse (`Splunk HEC HTTP <status>`) so the
 * dispatcher's delivery-log `error` column never carries the raw token.
 */

import type { SiemEnvelope } from '../format';

export async function sendSplunkHec(
  forwarder: {
    endpoint: string;
    credentialSecret: string | null;
    options: Record<string, unknown>;
  },
  env: SiemEnvelope,
): Promise<void> {
  if (!forwarder.credentialSecret) {
    throw new Error('Splunk HEC requires a credentialSecret (HEC token)');
  }
  const path = (forwarder.options.path as string | undefined) ?? '/services/collector';
  const sourcetype = (forwarder.options.sourcetype as string | undefined) ?? 'cairn:audit';
  const source = (forwarder.options.source as string | undefined) ?? 'cairn';
  const host = (forwarder.options.host as string | undefined) ?? 'cairn';
  const url = new URL(path, forwarder.endpoint).toString();
  const timeoutMs = (forwarder.options.timeoutMs as number | undefined) ?? 5_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Splunk ${forwarder.credentialSecret}`,
      },
      body: JSON.stringify({
        event: env,
        sourcetype,
        source,
        host,
        time: Math.floor(new Date(env.timestamp).getTime() / 1000),
      }),
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`Splunk HEC HTTP ${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

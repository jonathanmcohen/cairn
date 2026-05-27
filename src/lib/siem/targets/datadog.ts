/**
 * v0.9.0 G8 P40 — Datadog Logs API target.
 *
 * POSTs the audit envelope to `<endpoint>/api/v2/logs` with the Datadog
 * convention wrapper `{ddsource, service, hostname, ddtags, message, ...env}`
 * and a `DD-API-KEY: <key>` header. The API key is required — misconfig is
 * rejected early so the dispatcher's retry-row carries a clear error instead
 * of a 403 storm against the operator's intake.
 *
 * Default endpoint host is the operator's call; Datadog regions use distinct
 * intake hostnames (e.g. https://http-intake.logs.datadoghq.com for US1, ...eu
 * for EU). The forwarder's `endpoint` carries the full base URL.
 *
 * Error surface intentionally stays terse (`Datadog HTTP <status>`) so the
 * dispatcher's delivery-log `error` column never carries the raw API key.
 */

import type { SiemEnvelope } from '../format';

export async function sendDatadog(
  forwarder: {
    endpoint: string;
    credentialSecret: string | null;
    options: Record<string, unknown>;
  },
  env: SiemEnvelope,
): Promise<void> {
  if (!forwarder.credentialSecret) {
    throw new Error('Datadog target requires a credentialSecret (DD-API-KEY)');
  }
  const service = (forwarder.options.service as string | undefined) ?? 'cairn';
  const hostname = (forwarder.options.hostname as string | undefined) ?? 'cairn';
  const tagsArr = (forwarder.options.tags as string[] | undefined) ?? [];
  const url = new URL('/api/v2/logs', forwarder.endpoint).toString();
  const timeoutMs = (forwarder.options.timeoutMs as number | undefined) ?? 5_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const payload = [
      {
        ddsource: 'cairn',
        service,
        hostname,
        ddtags: [`workspace:${env.workspace_id}`, ...tagsArr].join(','),
        message: env.action,
        ...env,
      },
    ];
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'dd-api-key': forwarder.credentialSecret,
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`Datadog HTTP ${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

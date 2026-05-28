/**
 * v0.9.0 G8 P39 — Syslog target.
 *
 * Emits RFC 5424 frames over UDP (`udp://host:port`) or TCP (`tcp://host:port`).
 * Facility 16 (local0) + severity 6 (informational) — Cairn audit events
 * are operational, not kernel/security syslog. The structured-data slot is
 * unused (`-`); the MSG payload is the full JSON envelope so a downstream
 * SIEM can parse it with a simple `JSON()` extract.
 *
 * Frame layout:
 *   <PRI>1 TIMESTAMP HOSTNAME cairn - MSGID - {json envelope}
 *
 * Connection model: each send opens a fresh socket and closes it on
 * completion. SIEM volume in a homelab is small enough that pooling adds
 * complexity without measurable gain; if P40 raises throughput we can swap
 * to a long-lived TCP socket per forwarder.
 */

import { createSocket } from 'node:dgram';
import { createConnection } from 'node:net';
import type { SiemEnvelope } from '../format';

const FACILITY_LOCAL0 = 16;
const SEVERITY_INFORMATIONAL = 6;
const PRIORITY = FACILITY_LOCAL0 * 8 + SEVERITY_INFORMATIONAL;

function buildFrame(env: SiemEnvelope, hostname: string): string {
  const ts = env.timestamp;
  const app = 'cairn';
  const procid = '-';
  const msgid = env.action;
  const msg = JSON.stringify(env);
  return `<${PRIORITY}>1 ${ts} ${hostname} ${app} ${procid} ${msgid} - ${msg}`;
}

export async function sendSyslog(
  forwarder: { endpoint: string; options: Record<string, unknown> },
  env: SiemEnvelope,
): Promise<void> {
  const url = new URL(forwarder.endpoint);
  const hostname = (forwarder.options.hostname as string | undefined) ?? 'cairn';
  const frame = buildFrame(env, hostname);

  if (url.protocol === 'udp:') {
    await new Promise<void>((resolve, reject) => {
      const sock = createSocket('udp4');
      sock.send(frame, Number(url.port), url.hostname, (err) => {
        sock.close();
        if (err) reject(err);
        else resolve();
      });
    });
    return;
  }
  if (url.protocol === 'tcp:') {
    await new Promise<void>((resolve, reject) => {
      const sock = createConnection({ host: url.hostname, port: Number(url.port) });
      let settled = false;
      const settle = (err?: Error): void => {
        if (settled) return;
        settled = true;
        sock.removeAllListeners('error');
        if (err) reject(err);
        else resolve();
      };
      sock.once('connect', () => {
        sock.write(`${frame}\n`, (writeErr) => {
          sock.end();
          settle(writeErr ?? undefined);
        });
      });
      sock.once('error', (err) => settle(err));
    });
    return;
  }
  throw new Error(`unsupported syslog scheme: ${url.protocol}`);
}

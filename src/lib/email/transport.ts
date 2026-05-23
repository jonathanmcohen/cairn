import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/lib/env';

let cached: Transporter | null | undefined;

/**
 * Single source of truth for "is email enabled?". Configured transport when
 * SMTP_HOST is set, else null (email fully disabled — every send path no-ops on
 * null). Cached process-wide; tests reset via __resetTransport.
 */
export function getTransport(): Transporter | null {
  if (cached !== undefined) return cached;
  const e = env();
  if (!e.SMTP_HOST) {
    cached = null;
    return cached;
  }
  cached = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
  });
  return cached;
}

export function emailEnabled(): boolean {
  return getTransport() !== null;
}

export function fromAddress(): string {
  const e = env();
  return e.SMTP_FROM ?? e.SMTP_USER ?? 'cairn@localhost';
}

/** Test-only: drop the cached transport so a re-parsed env takes effect. */
export function __resetTransport(): void {
  cached = undefined;
}

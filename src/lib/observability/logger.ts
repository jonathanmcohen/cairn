import { pino } from 'pino';

/**
 * Redaction list — extends the v0.5.1 secret-hygiene rules. Uses pino's wildcard
 * path syntax so a secret-named field is redacted wherever it appears. Add new
 * secret classes HERE (single source of truth) and assert them in logger.test.ts.
 * Replacement marker is "[Redacted]".
 */
export const REDACT_PATHS: string[] = [
  '*.passwordHash',
  'passwordHash',
  '*.tokenHash',
  'tokenHash',
  '*.secret',
  'secret',
  '*.secret_encrypted',
  'secret_encrypted',
  '*.recovery_codes',
  'recovery_codes',
  'authorization',
  '*.authorization',
  'headers.authorization',
  'cookie',
  '*.cookie',
  'headers.cookie',
  'AUTH_SECRET',
  '*.AUTH_SECRET',
  'CAIRN_METRICS_TOKEN',
  '*.CAIRN_METRICS_TOKEN',
  '*.sig',
  'sig',
];

const level = process.env.CAIRN_LOG_LEVEL ?? 'info';

/** Shared application logger (JSON to stdout). */
export const logger = pino({
  level,
  redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
});

/** Test helper: same redaction config, writing each serialized line to a sink. */
export function createTestLogger(sink: (line: string) => void) {
  return pino(
    { level: 'trace', redact: { paths: REDACT_PATHS, censor: '[Redacted]' } },
    { write: (line: string) => sink(line) },
  );
}

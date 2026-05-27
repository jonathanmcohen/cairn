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
  // Embedding-provider bearer token (P11) — never printed even if a stray
  // log call interpolates process.env.
  'env.CAIRN_EMBEDDING_API_KEY',
  'CAIRN_EMBEDDING_API_KEY',
  '*.CAIRN_EMBEDDING_API_KEY',
  '*.sig',
  'sig',
  // v0.9.0 G7 P36 — chat-bridge per-workspace secrets + inbound auth headers.
  // The bot token + signing secret normally live in webhooks.platform_metadata
  // (jsonb), but stray env interpolation in a log line must never leak them.
  'env.CAIRN_SLACK_SIGNING_SECRET',
  'CAIRN_SLACK_SIGNING_SECRET',
  '*.CAIRN_SLACK_SIGNING_SECRET',
  'env.CAIRN_DISCORD_BOT_TOKEN',
  'CAIRN_DISCORD_BOT_TOKEN',
  '*.CAIRN_DISCORD_BOT_TOKEN',
  'req.headers["x-slack-signature"]',
  'req.headers["x-signature-ed25519"]',
  // v0.9.0 G7 P37 — per-install bot tokens + signing secrets stored on the
  // `chat_bridge_installs` row. If a route handler logs an install object the
  // raw values must never appear.
  '*.botToken',
  'botToken',
  '*.bot_token',
  'bot_token',
  '*.signingSecret',
  'signingSecret',
  '*.signing_secret',
  'signing_secret',
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

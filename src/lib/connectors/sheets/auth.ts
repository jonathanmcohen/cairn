import { google } from 'googleapis';
import { env } from '@/lib/env';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
];

/**
 * Plaintext shape of `database_connectors.auth_config` for the Sheets adapter,
 * after decryption via P19's `decryptAuthConfig`. The refresh token itself is
 * stored encrypted at rest via the v0.6 secret-box (key derived from
 * `AUTH_SECRET`); see `src/lib/connectors/auth.ts`.
 */
export type SheetsAuthConfig = {
  refresh_token: string;
};

/**
 * Build an unauthenticated OAuth2 client from env. Throws if either Google
 * OAuth env var is missing — preserves a boot path where no Sheets connector
 * is configured. Callers (OAuth routes + adapter) surface this as a 400.
 */
export function buildOAuthClient(redirectUri: string) {
  const clientId = env().CAIRN_GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env().CAIRN_GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth client not configured');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** Build a Google authorization URL with offline access + forced consent. */
export function buildAuthUrl(redirectUri: string, state: string): string {
  const client = buildOAuthClient(redirectUri);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force refresh_token even on re-grant
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });
}

/** Exchange an authorization `code` for tokens (must include `refresh_token`). */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<{ refresh_token: string; access_token?: string | null; expiry_date?: number | null }> {
  const client = buildOAuthClient(redirectUri);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('No refresh token returned (re-grant with prompt=consent)');
  }
  return {
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token ?? null,
    expiry_date: tokens.expiry_date ?? null,
  };
}

/**
 * Build an authorized OAuth2 client from a decrypted `SheetsAuthConfig`. The
 * googleapis client transparently refreshes the access token from the stored
 * refresh token on each call.
 */
export function loadAuthorizedClient(
  authConfig: SheetsAuthConfig,
  redirectUri = 'urn:ietf:wg:oauth:2.0:oob',
) {
  const client = buildOAuthClient(redirectUri);
  client.setCredentials({ refresh_token: authConfig.refresh_token });
  return client;
}

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { hashOauthToken, mintOauthSecret, OAUTH_PREFIX } from './tokens';

/**
 * v0.9.16 Plan F — RFC 7591 dynamic client registration.
 *
 * Public PKCE clients (Claude Desktop / Cursor) register WITHOUT a secret;
 * confidential clients (`token_endpoint_auth_method=client_secret_post`) get a
 * `cairn_ocs_…` secret returned once and stored sha256-hashed. The plaintext
 * secret is never re-fetchable.
 *
 * Every redirect URI must be an absolute http/https URL — the exact-match
 * allowlist enforced at /authorize and /token. A non-absolute or non-http(s)
 * URI is an open-redirect risk and is rejected at registration.
 */
export type RegisterClientInput = {
  clientName: string;
  redirectUris: string[];
  confidential: boolean;
  createdBy?: string | null;
};

export type RegisterClientResult = {
  row: schema.OauthClient;
  /** Plaintext client secret — returned ONCE for confidential clients, else null. */
  clientSecret: string | null;
};

/** True if `uri` is an absolute http(s) URL (open-redirect guard). */
export function isValidRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function registerClient(
  db: PostgresJsDatabase<typeof schema>,
  input: RegisterClientInput,
): Promise<RegisterClientResult> {
  const clientId = randomBytes(16).toString('hex');

  let clientSecret: string | null = null;
  let clientSecretHash: string | null = null;
  if (input.confidential) {
    clientSecret = mintOauthSecret(OAUTH_PREFIX.clientSecret);
    clientSecretHash = hashOauthToken(clientSecret);
  }

  const [row] = await db
    .insert(schema.oauthClients)
    .values({
      clientId,
      clientSecretHash,
      clientName: input.clientName,
      redirectUris: input.redirectUris,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  if (!row) throw new Error('registerClient: insert returned no row');

  return { row, clientSecret };
}

/** Load a registered client by its public `client_id`, or null. */
export async function loadClientByClientId(
  db: PostgresJsDatabase<typeof schema>,
  clientId: string,
): Promise<schema.OauthClient | null> {
  const [row] = await db
    .select()
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.clientId, clientId))
    .limit(1);
  return row ?? null;
}

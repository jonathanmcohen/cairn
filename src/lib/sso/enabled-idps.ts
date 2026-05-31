import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type EnabledIdp = {
  id: string;
  type: 'oidc' | 'saml';
  name: string;
  startPath: string;
};

/**
 * Public-safe list of every enabled IdP across the instance. The login page
 * is unauthenticated, so there is no workspace context to scope by; we expose
 * only id/type/name + the SP-initiated start path. `metadata` (clientSecret,
 * SAML private keys) is NEVER selected.
 */
export async function listEnabledIdps(
  db: PostgresJsDatabase<typeof schema>,
): Promise<EnabledIdp[]> {
  const rows = await db
    .select({
      id: schema.idpConfigurations.id,
      type: schema.idpConfigurations.type,
      name: schema.idpConfigurations.name,
    })
    .from(schema.idpConfigurations)
    .where(eq(schema.idpConfigurations.enabled, true))
    .orderBy(asc(schema.idpConfigurations.name));

  return rows.flatMap((r) => {
    if (r.type !== 'oidc' && r.type !== 'saml') return [];
    return [
      {
        id: r.id,
        type: r.type,
        name: r.name,
        startPath: `/api/sso/${r.type}/init/${r.id}`,
      },
    ];
  });
}

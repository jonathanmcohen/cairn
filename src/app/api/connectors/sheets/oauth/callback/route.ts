import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { encryptAuthConfig } from '@/lib/connectors/auth';
import { verifyOAuthState } from '@/lib/connectors/oauth-state';
import { exchangeCodeForTokens } from '@/lib/connectors/sheets/auth';

/**
 * GET `/api/connectors/sheets/oauth/callback?code=…&state=…`
 *
 * Exchanges the auth code for tokens, encrypts the refresh token into the
 * matching `database_connectors` row (insert-or-update), and redirects to the
 * per-connector config page. The user fills in spreadsheetId + column map next.
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const stateRaw = url.searchParams.get('state');
    if (!code || !stateRaw)
      return NextResponse.json({ error: 'missing code or state' }, { status: 400 });

    const state = verifyOAuthState(stateRaw);
    if (!state || state.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: 'invalid state' }, { status: 400 });
    }

    const redirectUri = new URL('/api/connectors/sheets/oauth/callback', url).toString();
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const authConfig = encryptAuthConfig({ refresh_token: tokens.refresh_token });

    const db = getDb();
    // Upsert: one connector per database. If a row already exists (replacing
    // an OAuth grant), update auth + kind; otherwise insert a fresh disabled
    // connector for the admin to configure.
    const [existing] = await db
      .select()
      .from(schema.databaseConnectors)
      .where(
        and(
          eq(schema.databaseConnectors.workspaceId, ctx.workspaceId),
          eq(schema.databaseConnectors.databaseId, state.databaseId),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(schema.databaseConnectors)
        .set({ authConfig, kind: 'google_sheets' })
        .where(eq(schema.databaseConnectors.id, existing.id));
    } else {
      await db.insert(schema.databaseConnectors).values({
        workspaceId: ctx.workspaceId,
        databaseId: state.databaseId,
        kind: 'google_sheets',
        authConfig,
        syncConfig: {},
        enabled: false,
        createdBy: ctx.userId,
      });
    }

    return NextResponse.redirect(
      new URL(`/settings/developer/connectors?databaseId=${state.databaseId}`, url),
    );
  } catch (err) {
    if (err instanceof HttpError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'internal error' },
      { status: 500 },
    );
  }
}

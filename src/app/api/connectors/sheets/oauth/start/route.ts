import { type NextRequest, NextResponse } from 'next/server';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { buildAuthUrl } from '@/lib/connectors/sheets/auth';
import { signOAuthState } from '@/lib/connectors/oauth-state';

/**
 * GET `/api/connectors/sheets/oauth/start?databaseId=…`
 *
 * Builds the Google authorization URL and redirects the admin's browser to it.
 * The `state` blob is an HMAC-signed JSON envelope so the callback can recover
 * `(workspaceId, databaseId)` without a server-side session map.
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const url = new URL(req.url);
    const databaseId = url.searchParams.get('databaseId');
    if (!databaseId)
      return NextResponse.json({ error: 'databaseId required' }, { status: 400 });

    const redirectUri = new URL('/api/connectors/sheets/oauth/callback', url).toString();
    const state = signOAuthState({ workspaceId: ctx.workspaceId, databaseId });
    const authUrl = buildAuthUrl(redirectUri, state);
    return NextResponse.redirect(authUrl);
  } catch (err) {
    if (err instanceof HttpError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'internal error' },
      { status: 500 },
    );
  }
}

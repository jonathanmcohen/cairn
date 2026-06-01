import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { buildAuthorizeUrl, oauthRedirectUri } from '@/lib/chat/oauth-providers';
import { signOauthState } from '@/lib/chat/oauth-state';
import { publicOrigin } from '@/lib/url';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const clientId = process.env.CAIRN_SLACK_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ error: 'Slack OAuth is not configured' }, { status: 500 });
    }
    const origin = await publicOrigin();
    const redirectUri = await oauthRedirectUri(origin, 'slack');
    const state = await signOauthState({
      workspaceId: ctx.workspaceId,
      platform: 'slack',
      nonce: randomUUID(),
    });
    const authorizeUrl = buildAuthorizeUrl('slack', { clientId, redirectUri, state });
    return NextResponse.redirect(authorizeUrl);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

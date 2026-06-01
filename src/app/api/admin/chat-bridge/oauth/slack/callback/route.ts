import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { exchangeCode } from '@/lib/chat/oauth-exchange';
import { persistInstall } from '@/lib/chat/oauth-install';
import { oauthRedirectUri } from '@/lib/chat/oauth-providers';
import { verifyOauthState } from '@/lib/chat/oauth-state';
import { publicOrigin } from '@/lib/url';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      return NextResponse.json({ error: 'missing code/state' }, { status: 400 });
    }
    let payload: Awaited<ReturnType<typeof verifyOauthState>>;
    try {
      payload = await verifyOauthState(state, 'slack');
    } catch {
      return NextResponse.json({ error: 'invalid state' }, { status: 400 });
    }
    const ctx = await requireRole('admin');
    if (ctx.workspaceId !== payload.workspaceId) {
      return NextResponse.json({ error: 'workspace mismatch' }, { status: 403 });
    }
    const clientId = process.env.CAIRN_SLACK_CLIENT_ID;
    const clientSecret = process.env.CAIRN_SLACK_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return NextResponse.json({ error: 'Slack OAuth not configured' }, { status: 500 });
    }
    const origin = await publicOrigin();
    const redirectUri = await oauthRedirectUri(origin, 'slack');
    const result = await exchangeCode('slack', { code, clientId, clientSecret, redirectUri });
    await persistInstall(getDb(), {
      workspaceId: ctx.workspaceId,
      installedBy: ctx.userId,
      platform: 'slack',
      externalTeamId: result.externalTeamId,
      botToken: result.botToken,
      scopes: result.scopes,
    });
    return NextResponse.redirect(`${origin}/admin/chat-bridge?installed=slack`);
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

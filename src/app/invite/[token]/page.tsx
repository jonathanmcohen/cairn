import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext } from '@/lib/auth/require-role';
import { AcceptInviteButton } from './accept-button';

export default async function InviteLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const ctx = await getAuthContext();

  // Logged out → bounce to signup with the token prefilled.
  if (!ctx) {
    redirect(`/signup?invite=${encodeURIComponent(token)}`);
  }

  // Look up the invite + its workspace for display + validity.
  const db = getDb();
  const [invite] = await db
    .select({
      id: schema.inviteTokens.id,
      usedAt: schema.inviteTokens.usedAt,
      expiresAt: schema.inviteTokens.expiresAt,
      workspaceName: schema.workspaces.name,
    })
    .from(schema.inviteTokens)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.inviteTokens.workspaceId))
    .where(eq(schema.inviteTokens.token, token))
    .limit(1);

  const invalid = !invite || invite.usedAt !== null || invite.expiresAt < new Date();

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      {invalid ? (
        <>
          <h1 className="text-2xl font-semibold">Invalid or expired invite</h1>
          <p className="text-muted-foreground">
            This invite link is no longer valid. Ask whoever invited you to send a new one.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Join {invite.workspaceName}</h1>
          <p className="text-muted-foreground">
            You&apos;ve been invited to the {invite.workspaceName} workspace.
          </p>
          <AcceptInviteButton token={token} />
        </>
      )}
    </div>
  );
}

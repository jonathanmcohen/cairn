/**
 * v0.9.8 G6 (audit F) — persist a completed chat OAuth install.
 *
 * Upserts on (workspace_id, platform, external_team_id): a re-install rotates
 * the sealed bot token + scopes and clears revoked_at. The plaintext token is
 * sealed here and never returned.
 */

import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import type { ChatOauthPlatform } from '@/lib/chat/oauth-state';
import { sealBotToken } from '@/lib/chat/oauth-token';

type Db = PostgresJsDatabase<typeof schema>;

export async function persistInstall(
  db: Db,
  input: {
    workspaceId: string;
    installedBy: string;
    platform: ChatOauthPlatform;
    externalTeamId: string;
    botToken: string;
    scopes: string[];
  },
): Promise<void> {
  const botTokenEncrypted = sealBotToken(input.botToken);

  const [existing] = await db
    .select({ id: schema.chatOauthInstalls.id })
    .from(schema.chatOauthInstalls)
    .where(
      and(
        eq(schema.chatOauthInstalls.workspaceId, input.workspaceId),
        eq(schema.chatOauthInstalls.platform, input.platform),
        eq(schema.chatOauthInstalls.externalTeamId, input.externalTeamId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.chatOauthInstalls)
      .set({
        botTokenEncrypted,
        scopes: input.scopes,
        installedBy: input.installedBy,
        installedAt: new Date(),
        revokedAt: null,
      })
      .where(eq(schema.chatOauthInstalls.id, existing.id));
  } else {
    await db.insert(schema.chatOauthInstalls).values({
      workspaceId: input.workspaceId,
      platform: input.platform,
      externalTeamId: input.externalTeamId,
      botTokenEncrypted,
      scopes: input.scopes,
      installedBy: input.installedBy,
    });
  }

  await recordAudit(db, {
    workspaceId: input.workspaceId,
    actorUserId: input.installedBy,
    action: 'chat.oauth_installed',
    targetType: 'chat_oauth_install',
    metadata: {
      platform: input.platform,
      externalTeamId: input.externalTeamId,
      op: existing ? 'updated' : 'created',
      scopeCount: input.scopes.length, // NEVER the token.
    },
  });
}

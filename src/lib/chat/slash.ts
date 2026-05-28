/**
 * v0.9.0 G7 P37 — chat-bridge slash command parser + executor.
 *
 * The parser is platform-agnostic: it converts a raw command text (the part
 * AFTER `/cairn `) into a typed struct. The executor (`executeSlashCommand`)
 * runs against the workspace's install context and returns a uniform
 * `SlashResponse` that the platform-specific route handlers (Slack + Discord)
 * shape into the wire format each platform expects.
 *
 * Supported commands:
 *   • `search <query>`       — top-5 page-search hits via v0.6 P22 FTS.
 *   • `create page <title>`  — creates a page authored by the install's
 *                              `installed_by` user. Returns the page URL.
 *
 * Both commands return ephemeral (channel-private) responses by default so a
 * chat user can search without spamming the channel.
 */

import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { searchPages } from '@/lib/pages/search';

export type SlashCommand =
  | { kind: 'search'; query: string }
  | { kind: 'create_page'; title: string }
  | { kind: 'error'; message: string };

const MAX_TITLE = 255;
const MAX_QUERY = 200;

export function parseSlashCommand(raw: string): SlashCommand {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text) return { kind: 'error', message: 'empty command' };

  if (text === 'search') return { kind: 'error', message: 'search query required' };
  if (text.startsWith('search ')) {
    const query = text.slice('search '.length).trim();
    if (!query) return { kind: 'error', message: 'search query required' };
    return { kind: 'search', query: query.slice(0, MAX_QUERY) };
  }

  if (text === 'create page') return { kind: 'error', message: 'page title required' };
  if (text.startsWith('create page ')) {
    const title = text.slice('create page '.length).trim();
    if (!title) return { kind: 'error', message: 'page title required' };
    return { kind: 'create_page', title: title.slice(0, MAX_TITLE) };
  }

  return { kind: 'error', message: `unknown command: ${text.split(' ')[0]}` };
}

export type SlashContext = {
  workspaceId: string;
  installId: string;
  invokingChatUserId: string;
  channelId: string;
};

export type SlashResponse =
  | { kind: 'message'; text: string; ephemeral: boolean }
  | { kind: 'message_with_link'; text: string; pageId: string; pageUrl: string };

/**
 * Execute a parsed slash command against the workspace's install context.
 * The caller is the platform-specific route handler; this is pure-ish (only
 * touches the DB) and returns a wire-shaped response.
 */
export async function executeSlashCommand(
  cmd: SlashCommand,
  ctx: SlashContext,
  publicUrl: string,
): Promise<SlashResponse> {
  if (cmd.kind === 'error') {
    return { kind: 'message', text: `error: ${cmd.message}`, ephemeral: true };
  }

  const db = getDb();

  if (cmd.kind === 'search') {
    const results = await searchPages(db, {
      workspaceId: ctx.workspaceId,
      query: cmd.query,
      limit: 5,
    });
    if (results.length === 0) {
      return {
        kind: 'message',
        text: `no results for "${cmd.query}"`,
        ephemeral: true,
      };
    }
    const lines = results.map((r, i) => `${i + 1}. ${r.title} — ${publicUrl}/pages/${r.id}`);
    return {
      kind: 'message',
      text: [`Top ${results.length} results for "${cmd.query}":`, ...lines].join('\n'),
      ephemeral: true,
    };
  }

  // create_page
  const [install] = await db
    .select()
    .from(schema.chatBridgeInstalls)
    .where(eq(schema.chatBridgeInstalls.id, ctx.installId))
    .limit(1);
  if (!install) {
    return { kind: 'message', text: 'install not found', ephemeral: true };
  }
  const [page] = await db
    .insert(schema.pages)
    .values({
      workspaceId: ctx.workspaceId,
      title: cmd.title,
      content: { type: 'doc', content: [] },
      createdBy: install.installedBy,
    })
    .returning();
  if (!page) {
    return { kind: 'message', text: 'failed to create page', ephemeral: true };
  }
  const pageUrl = `${publicUrl}/pages/${page.id}`;
  return {
    kind: 'message_with_link',
    text: `Created "${cmd.title}": ${pageUrl}`,
    pageId: page.id,
    pageUrl,
  };
}

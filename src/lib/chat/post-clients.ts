/**
 * v0.9.0 G7 P37 — thin wrappers around Slack `chat.postMessage` and Discord
 * `channels.createMessage`. Used by the comment-created post-back path
 * (`postCommentToChannels`) so a freshly-created page comment fans out to
 * every linked sync channel.
 *
 * Both clients return the platform-side message id, although the post-back
 * path currently discards it — the dedupe key on the inbound path uses the
 * SAME id, but inbound delivery comes from the platform webhook (not us).
 * Plumbing the returned id back to the linked comment row is a TODO for a
 * future refinement that would let us short-circuit the platform round-trip.
 */

import { logger } from '@/lib/observability/logger';
import type { PostFnArgs } from './sync';

const SLACK_POST_URL = 'https://slack.com/api/chat.postMessage';
const DISCORD_API_BASE = 'https://discord.com/api/v10';

export async function postToChat(args: PostFnArgs): Promise<void> {
  if (args.platform === 'slack') {
    const res = await fetch(SLACK_POST_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${args.botToken}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel: args.channelId, text: args.body }),
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status, channel: args.channelId },
        '[chat] slack chat.postMessage non-2xx',
      );
      throw new Error(`slack chat.postMessage ${res.status}`);
    }
    return;
  }
  // discord
  const res = await fetch(`${DISCORD_API_BASE}/channels/${args.channelId}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bot ${args.botToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ content: args.body }),
  });
  if (!res.ok) {
    logger.warn(
      { status: res.status, channel: args.channelId },
      '[chat] discord createMessage non-2xx',
    );
    throw new Error(`discord createMessage ${res.status}`);
  }
}

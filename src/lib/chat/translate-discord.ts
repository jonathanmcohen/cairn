/**
 * v0.9.0 G7 P36 — Cairn canonical event → Discord webhook payload.
 *
 * Discord webhook executes accept `{content?, embeds?}`. We always include an
 * embed (richer rendering) and put a short summary in `content` so the channel
 * notification preview is readable even when embeds are collapsed.
 */

import type { CairnChatEvent } from './translate-slack';

export type DiscordMessage = {
  content?: string;
  embeds?: Array<{
    title?: string;
    url?: string;
    description?: string;
    author?: { name: string };
    color?: number;
  }>;
};

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function translateToDiscord(input: CairnChatEvent): DiscordMessage {
  switch (input.event) {
    case 'page.created':
    case 'page.updated': {
      const verb = input.event === 'page.created' ? 'created' : 'updated';
      const actor = input.data.actor?.name ?? 'Someone';
      return {
        content: `${actor} ${verb} a page`,
        embeds: [
          {
            title: input.data.page.title,
            url: input.data.page.publicUrl ?? undefined,
            author: { name: actor },
          },
        ],
      };
    }
    case 'comment.created': {
      const actor = input.data.comment.authorName ?? 'Someone';
      return {
        content: `${actor} commented on a page`,
        embeds: [
          {
            title: input.data.page.title,
            url: input.data.page.publicUrl ?? undefined,
            description: truncate(input.data.comment.body, 1000),
            author: { name: actor },
          },
        ],
      };
    }
  }
}

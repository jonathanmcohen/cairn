/**
 * v0.9.0 G7 P36 — Cairn canonical event → Slack incoming-webhook payload.
 *
 * The dispatcher invokes this translator before POSTing to a `kind = 'slack'`
 * webhook. Output is the JSON body Slack's chat.postMessage / incoming-webhook
 * endpoints accept: `{text, blocks?}` (mrkdwn).
 *
 * Encrypted-page redaction (spec §6 risks): callers MUST pre-redact bodies
 * for encrypted pages before handing them to the translator. The translator
 * itself is a pure transform — it does not read DB state.
 */

export type CairnChatEvent =
  | {
      event: 'page.created' | 'page.updated';
      data: {
        page: { id: string; title: string; publicUrl?: string | null };
        actor?: { name?: string | null } | null;
      };
    }
  | {
      event: 'comment.created';
      data: {
        page: { id: string; title: string; publicUrl?: string | null };
        comment: { id: string; body: string; authorName?: string | null };
      };
    };

export type SlackMessage = {
  text: string;
  blocks?: Array<Record<string, unknown>>;
};

/** Cap a long body so we don't blow past Slack's 40k payload limit. */
function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Slack mrkdwn link helper: `<url|text>`. Plain text fallback when no url. */
function link(text: string, url: string | null | undefined): string {
  return url ? `<${url}|${text}>` : text;
}

export function translateToSlack(input: CairnChatEvent): SlackMessage {
  switch (input.event) {
    case 'page.created':
    case 'page.updated': {
      const verb = input.event === 'page.created' ? 'created' : 'updated';
      const actor = input.data.actor?.name ?? 'Someone';
      const pageLink = link(input.data.page.title, input.data.page.publicUrl);
      const text = `${actor} ${verb} ${pageLink}`;
      return {
        text,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text },
          },
        ],
      };
    }
    case 'comment.created': {
      const actor = input.data.comment.authorName ?? 'Someone';
      const pageLink = link(input.data.page.title, input.data.page.publicUrl);
      const body = truncate(input.data.comment.body, 400);
      const header = `${actor} commented on ${pageLink}`;
      // Render the body as a Slack blockquote so threaded replies show context.
      const quoted = body
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      return {
        text: header,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: header } },
          { type: 'section', text: { type: 'mrkdwn', text: quoted } },
        ],
      };
    }
  }
}

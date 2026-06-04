import { TemplatePayloadSchema } from './payload';

/**
 * A single line in the read-only template preview drawer (#68/#248). Derived
 * server-side from the stored `payload` jsonb so the gallery never has to ship
 * the full instantiable template to the client.
 */
export type PreviewBlock =
  | { kind: 'page'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; text: string }
  | { kind: 'callout'; text: string }
  | { kind: 'database'; text: string };

export type TemplatePreview = {
  name: string;
  kind: 'page' | 'database';
  blocks: PreviewBlock[];
};

/** Cap text length so a verbose paragraph can't blow up the drawer. */
const MAX_TEXT = 140;
/** Cap total blocks — this is a preview, not a full render. */
const MAX_BLOCKS = 60;

function clamp(s: string, max = MAX_TEXT): string {
  const trimmed = s.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

type ProseNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: ProseNode[];
};

/** Recursively concatenate every `text` leaf under a node. */
function collectText(node: ProseNode | undefined): string {
  if (!node) return '';
  let out = node.type === 'text' && typeof node.text === 'string' ? node.text : '';
  if (Array.isArray(node.content)) {
    for (const child of node.content) out += collectText(child);
  }
  return out;
}

/**
 * Build an ordered, truncated block summary for a template payload. Pure and
 * defensive: unknown / empty nodes are skipped, never thrown on. Parsing goes
 * through `TemplatePayloadSchema` so malformed payloads degrade gracefully.
 */
export function buildTemplatePreview(payload: unknown): TemplatePreview {
  const parsed = TemplatePayloadSchema.safeParse(payload);
  const data = parsed.success ? parsed.data : { kind: 'page' as const, pages: [], databases: [] };

  const blocks: PreviewBlock[] = [];
  const push = (b: PreviewBlock) => {
    if (blocks.length < MAX_BLOCKS) blocks.push(b);
  };

  for (const page of data.pages) {
    push({ kind: 'page', text: clamp(page.title) });
    const doc = page.content as ProseNode | undefined;
    const top = Array.isArray(doc?.content) ? (doc?.content as ProseNode[]) : [];
    for (const node of top) {
      if (blocks.length >= MAX_BLOCKS) break;
      switch (node.type) {
        case 'heading': {
          const text = clamp(collectText(node));
          if (text) {
            const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1;
            push({ kind: 'heading', level, text });
          }
          break;
        }
        case 'paragraph': {
          const text = clamp(collectText(node));
          if (text) push({ kind: 'paragraph', text });
          break;
        }
        case 'bulletList':
        case 'orderedList':
        case 'taskList': {
          for (const item of node.content ?? []) {
            if (blocks.length >= MAX_BLOCKS) break;
            const text = clamp(collectText(item));
            if (text) push({ kind: 'list', text });
          }
          break;
        }
        case 'callout': {
          const text = clamp(collectText(node));
          if (text) push({ kind: 'callout', text });
          break;
        }
        default:
          // Unknown / unsupported node — skip silently.
          break;
      }
    }
  }

  for (const db of data.databases) {
    push({ kind: 'database', text: clamp(db.name) });
  }

  return { name: '', kind: data.kind, blocks };
}

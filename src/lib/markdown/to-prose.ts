import { type Token, type Tokens, marked } from 'marked';

type Doc = {
  type: string;
  content?: Doc[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

export function markdownToProse(md: string): Doc {
  const tokens = marked.lexer(md);
  const blocks: Doc[] = tokens.map(tokenToBlock).filter((b): b is Doc => b !== null);
  return { type: 'doc', content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }] };
}

function tokenToBlock(t: Token): Doc | null {
  switch (t.type) {
    case 'heading':
      return {
        type: 'heading',
        attrs: { level: Math.min(t.depth, 3) },
        content: inlineFromText(t.text),
      };
    case 'paragraph':
      return { type: 'paragraph', content: inlineFromText(t.text) };
    case 'code':
      return {
        type: 'codeBlock',
        attrs: { language: t.lang ?? '' },
        content: [{ type: 'text', text: t.text }],
      };
    case 'blockquote': {
      const inner = (t.tokens ?? []).map(tokenToBlock).filter((x): x is Doc => x !== null);
      return { type: 'blockquote', content: inner };
    }
    case 'list': {
      const listType = t.ordered ? 'orderedList' : 'bulletList';
      const items: Doc[] = t.items.map((item: Tokens.ListItem) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: inlineFromText(item.text) }],
      }));
      return { type: listType, content: items };
    }
    case 'hr':
      return { type: 'horizontalRule' };
    case 'space':
      return null;
    default:
      return { type: 'paragraph', content: inlineFromText((t as { raw?: string }).raw ?? '') };
  }
}

function inlineFromText(text: string): Doc[] {
  // Best-effort: passes through as plain text. Mark fidelity deferred.
  return [{ type: 'text', text }];
}

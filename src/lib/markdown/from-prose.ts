type Doc = {
  type: string;
  content?: Doc[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

export function proseToMarkdown(doc: unknown): string {
  return `${renderNode(doc as Doc, 0).trim()}\n`;
}

function renderNode(node: Doc, depth: number): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map((c) => renderNode(c, depth)).join('\n\n');
    case 'paragraph':
      return renderInline(node);
    case 'heading': {
      const level = Math.min(Math.max((node.attrs?.level as number) ?? 1, 1), 6);
      return `${'#'.repeat(level)} ${renderInline(node)}`;
    }
    case 'bulletList':
      return (node.content ?? []).map((li) => `- ${renderNode(li, depth + 1)}`).join('\n');
    case 'orderedList':
      return (node.content ?? [])
        .map((li, i) => `${i + 1}. ${renderNode(li, depth + 1)}`)
        .join('\n');
    case 'listItem':
      return (node.content ?? []).map((c) => renderNode(c, depth)).join('\n');
    case 'taskList':
      return (node.content ?? []).map((li) => renderNode(li, depth + 1)).join('\n');
    case 'taskItem': {
      const checked = (node.attrs?.checked as boolean) ? 'x' : ' ';
      const inner = (node.content ?? []).map((c) => renderInline(c)).join(' ');
      return `- [${checked}] ${inner}`;
    }
    case 'blockquote':
      return (node.content ?? [])
        .map((c) => renderNode(c, depth))
        .join('\n')
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    case 'codeBlock': {
      const lang = (node.attrs?.language as string) ?? '';
      const text = (node.content ?? []).map((c) => c.text ?? '').join('');
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    case 'horizontalRule':
      return '---';
    case 'callout': {
      const color = (node.attrs?.color as string) ?? 'default';
      const inner = (node.content ?? []).map((c) => renderNode(c, depth)).join('\n');
      const body = inner
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
      return `> [!${color}]\n${body}`;
    }
    case 'cairnImage':
      return `![${(node.attrs?.alt as string) ?? ''}](${(node.attrs?.src as string) ?? ''})`;
    case 'fileAttachment':
      return `[📎 ${(node.attrs?.name as string) ?? 'file'}](${(node.attrs?.href as string) ?? ''})`;
    default:
      return renderInline(node);
  }
}

function renderInline(node: Doc): string {
  if (node.type === 'text') {
    let text = node.text ?? '';
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text = `**${text}**`;
      else if (mark.type === 'italic') text = `*${text}*`;
      else if (mark.type === 'code') text = `\`${text}\``;
      else if (mark.type === 'strike') text = `~~${text}~~`;
      else if (mark.type === 'link') text = `[${text}](${(mark.attrs?.href as string) ?? ''})`;
    }
    return text;
  }
  return (node.content ?? []).map((c) => renderInline(c)).join('');
}

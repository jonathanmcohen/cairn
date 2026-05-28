import { describe, expect, it } from 'vitest';
import { translateToDiscord } from '@/lib/chat/translate-discord';

describe('translateToDiscord', () => {
  it('renders page.created with an embed + title + URL', () => {
    const payload = translateToDiscord({
      event: 'page.created',
      data: {
        page: { id: 'p1', title: 'Hello world', publicUrl: 'https://x/p/h' },
        actor: { name: 'Alice' },
      },
    });
    expect(payload.content).toMatch(/Alice/);
    expect(payload.embeds).toBeDefined();
    expect(payload.embeds?.[0]?.title).toBe('Hello world');
    expect(payload.embeds?.[0]?.url).toBe('https://x/p/h');
    expect(payload.embeds?.[0]?.author?.name).toBe('Alice');
  });

  it('falls back to "Someone" when actor is null', () => {
    const payload = translateToDiscord({
      event: 'page.created',
      data: { page: { id: 'p1', title: 'T', publicUrl: null }, actor: null },
    });
    expect(payload.content).toMatch(/Someone/);
  });

  it('renders comment.created with the body in the embed description (truncated)', () => {
    const payload = translateToDiscord({
      event: 'comment.created',
      data: {
        page: { id: 'p1', title: 'P', publicUrl: 'https://x/p/p' },
        comment: { id: 'c1', body: 'b'.repeat(2000), authorName: 'Bob' },
      },
    });
    expect(payload.content).toMatch(/Bob/);
    const desc = payload.embeds?.[0]?.description ?? '';
    // Truncated to <= 1000 chars + ellipsis.
    expect(desc.length).toBeLessThanOrEqual(1000);
    expect(desc.endsWith('…')).toBe(true);
  });
});

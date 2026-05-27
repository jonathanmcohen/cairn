import { describe, expect, it } from 'vitest';
import { translateToSlack } from '@/lib/chat/translate-slack';

describe('translateToSlack', () => {
  it('renders page.created with a section block + permalink', () => {
    const payload = translateToSlack({
      event: 'page.created',
      data: {
        page: { id: 'p1', title: 'New page', publicUrl: 'https://cairn.example/p/n' },
        actor: { name: 'Alice' },
      },
    });
    expect(payload.text).toMatch(/Alice/);
    expect(payload.text).toMatch(/created/);
    expect(payload.blocks).toBeDefined();
    expect(payload.blocks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'section' })]),
    );
    expect(JSON.stringify(payload)).toContain('https://cairn.example/p/n');
  });

  it('renders page.updated with the "updated" verb', () => {
    const payload = translateToSlack({
      event: 'page.updated',
      data: {
        page: { id: 'p1', title: 'Edited', publicUrl: null },
        actor: { name: 'Bob' },
      },
    });
    expect(payload.text).toMatch(/Bob/);
    expect(payload.text).toMatch(/updated/);
  });

  it('falls back to "Someone" when actor is null', () => {
    const payload = translateToSlack({
      event: 'page.created',
      data: { page: { id: 'p1', title: 'T', publicUrl: null }, actor: null },
    });
    expect(payload.text).toMatch(/Someone/);
  });

  it('renders comment.created with the comment body truncated', () => {
    const payload = translateToSlack({
      event: 'comment.created',
      data: {
        page: { id: 'p1', title: 'P', publicUrl: 'https://x/p/p' },
        comment: { id: 'c1', body: 'a'.repeat(500), authorName: 'Bob' },
      },
    });
    expect(payload.text).toMatch(/Bob/);
    expect(payload.text).toMatch(/commented/);
    // Comment body must appear in some block (quoted).
    const flat = JSON.stringify(payload);
    expect(flat).toContain('> aaaa');
    // Slack message size sanity cap.
    expect(flat.length).toBeLessThan(2000);
  });
});

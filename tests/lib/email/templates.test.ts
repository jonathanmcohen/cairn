import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notification } from '@/db/schema/notifications';

// Mock the SSRF guard so we control whether a link's host is "public".
// Default: resolves (public). Tests flip `assertImpl` to throw to simulate private.
let assertImpl: (url: string) => Promise<void> = async () => {};
vi.mock('@/lib/webhooks/ssrf', () => ({
  assertPublicUrl: (url: string) => assertImpl(url),
}));

const BASE_ENV = {
  DATABASE_URL: 'postgres://u:p@h:5432/d',
  AUTH_SECRET: 'x'.repeat(32),
  NEXTAUTH_URL: 'https://cairn.example.com',
};

function notif(over: Partial<Notification> = {}): Notification {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    workspaceId: '33333333-3333-3333-3333-333333333333',
    type: 'mention',
    payload: {
      pageId: 'page-abc',
      commentId: 'cmt-xyz',
      actorId: '44444444-4444-4444-4444-444444444444',
    },
    readAt: null,
    createdAt: new Date('2026-05-22T00:00:00Z'),
    ...over,
  };
}

async function load() {
  vi.resetModules();
  return import('@/lib/email/templates');
}

describe('email templates', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env = { ...original, ...BASE_ENV };
    assertImpl = async () => {};
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('renders a per-event mention email with a deep link', async () => {
    const { renderNotificationEmail } = await load();
    const email = await renderNotificationEmail(notif());

    const expectedUrl = 'https://cairn.example.com/pages/page-abc#comment-cmt-xyz';
    expect(email.subject).toBe('You were mentioned');
    expect(email.text).toContain(expectedUrl);
    expect(email.html).toContain(`<a href="${expectedUrl}"`);
    expect(email.text).toContain('mentioned you');
  });

  it('uses comment_reply copy for reply notifications', async () => {
    const { renderNotificationEmail } = await load();
    const email = await renderNotificationEmail(notif({ type: 'comment_reply' }));
    expect(email.subject).toBe('New reply to your comment');
    expect(email.text).toContain('replied to your comment');
  });

  it('HTML-escapes special characters in the link', async () => {
    const { renderNotificationEmail } = await load();
    const email = await renderNotificationEmail(
      notif({
        payload: {
          pageId: 'a&b',
          commentId: 'c"d',
          actorId: 'x',
        },
      }),
    );
    expect(email.html).toContain('a&amp;b');
    expect(email.html).toContain('c&quot;d');
    // Raw, unescaped characters must not leak into the HTML.
    expect(email.html).not.toContain('a&b#');
  });

  it('renders a digest summarizing 3 notifications', async () => {
    const { renderDigestEmail } = await load();
    const email = await renderDigestEmail([
      notif({ payload: { pageId: 'p1', commentId: 'c1', actorId: 'a' } }),
      notif({ type: 'comment_reply', payload: { pageId: 'p2', commentId: 'c2', actorId: 'a' } }),
      notif({ payload: { pageId: 'p3', commentId: 'c3', actorId: 'a' } }),
    ]);

    expect(email.subject).toBe('3 new notifications in Cairn');
    // Three plain-text bullets, one per notification.
    expect(email.text.match(/^- /gm)?.length).toBe(3);
    expect(email.text).toContain('https://cairn.example.com/pages/p1#comment-c1');
    expect(email.text).toContain('https://cairn.example.com/pages/p3#comment-c3');
    expect(email.html.match(/<li/g)?.length).toBe(3);
  });

  it('rejects a per-event email when the link host is private (SSRF guard on path)', async () => {
    const { renderNotificationEmail } = await load();
    assertImpl = async () => {
      throw new Error('Refusing webhook URL: private address');
    };
    await expect(renderNotificationEmail(notif())).rejects.toThrow(/private|Refusing/);
  });

  it('rejects a digest email when any link host is private', async () => {
    const { renderDigestEmail } = await load();
    assertImpl = async () => {
      throw new Error('Refusing webhook URL: private address');
    };
    await expect(renderDigestEmail([notif()])).rejects.toThrow(/private|Refusing/);
  });
});

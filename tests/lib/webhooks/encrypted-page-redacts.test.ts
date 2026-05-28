import { describe, expect, it } from 'vitest';
import { buildPageWebhookPayload } from '@/lib/webhooks/payload';

describe('buildPageWebhookPayload — encryption redaction', () => {
  it('redacts body + sets page.encrypted=true for an encrypted page', () => {
    const payload = buildPageWebhookPayload({
      event: 'page.updated',
      page: {
        id: 'p1',
        title: 'Confidential',
        encrypted: true,
        content: { type: 'doc', content: [{ type: 'text', text: 'leak' }] },
        contentText: 'leak',
      },
    });
    expect(payload.body).toBeNull();
    expect(payload.page).toEqual({ id: 'p1', title: 'Confidential', encrypted: true });
    expect((payload as { contentText?: unknown }).contentText).toBeUndefined();
  });

  it('passes content through for a non-encrypted page', () => {
    const content = { type: 'doc', content: [{ type: 'paragraph' }] };
    const payload = buildPageWebhookPayload({
      event: 'page.updated',
      page: { id: 'p2', title: 'Public', encrypted: false, content, contentText: 'hi' },
    });
    expect(payload.body).toEqual(content);
    expect(payload.page).toEqual({ id: 'p2', title: 'Public', encrypted: false });
  });

  it('is fail-closed when encrypted is undefined', () => {
    const payload = buildPageWebhookPayload({
      event: 'page.updated',
      page: { id: 'p3', title: 'Unknown', content: { stuff: 1 } },
    });
    expect(payload.body).toBeNull();
    expect(payload.page.encrypted).toBe(true);
  });

  it('is fail-closed when encrypted is null', () => {
    const payload = buildPageWebhookPayload({
      event: 'page.updated',
      page: { id: 'p4', title: 'Null', encrypted: null, content: { stuff: 1 } },
    });
    expect(payload.body).toBeNull();
    expect(payload.page.encrypted).toBe(true);
  });
});

// v0.10.2 P2 — editor block-spacing rhythm. Audit-corrected targets (the
// seeded "halve typography defaults" premise was wrong — the editable surface
// already overrides them via .ProseMirror[contenteditable="true"] rules):
//   h1 after a block: 32px (was the 6px blanket sibling gap)
//   h2: stays 24px (already shipped — regression guard)
//   p after p: 12px (was 6px)
//   ul after a block: 8px (was 6px)
//   first child: no top margin (rules are sibling-scoped)
// The bug class is a CSS cascade/specificity outcome — only computed style in
// a real browser proves it (class-presence checks false-green).
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi, openPageEditor, pmDoc, pmHeading, pmParagraph } from './util';

function pmBulletList(...items: string[]): Record<string, unknown> {
  return {
    type: 'bulletList',
    content: items.map((text) => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })),
  };
}

async function marginTopOf(page: import('@playwright/test').Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return Number.parseFloat(getComputedStyle(el).marginTop);
  }, selector);
}

const EDITOR = '.ProseMirror[contenteditable="true"]';

test.describe('P2 — editor block spacing', () => {
  test('computed margins on the editable surface match the locked rhythm', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const s = Date.now().toString(36);
    const sentinel = `P2 seed ${s}`;
    const pageId = await createPageViaApi(
      page,
      `P2 spacing ${s}`,
      pmDoc(
        pmParagraph(sentinel), // first child — must stay flush
        pmHeading(1, 'H1 block'),
        pmHeading(2, 'H2 block'),
        pmParagraph('para A'),
        pmParagraph('para B'), // p after p → 12px
        pmBulletList('item one'), // ul after p → 8px
      ),
    );
    await openPageEditor(page, pageId, sentinel);

    expect(await marginTopOf(page, `${EDITOR} > h1`)).toBe(32);
    expect(await marginTopOf(page, `${EDITOR} > h2`)).toBe(24);
    expect(await marginTopOf(page, `${EDITOR} > p:nth-of-type(3)`)).toBe(12);
    expect(await marginTopOf(page, `${EDITOR} > ul`)).toBe(8);
    // First child keeps a flush top — sibling-scoped rules must not add one.
    expect(await marginTopOf(page, `${EDITOR} > p:first-child`)).toBe(0);

    // Scoping-leak guard: the PUBLIC reader (/p/<slug>, contenteditable=false)
    // keeps @tailwindcss/typography rhythm — the editor values must not leak.
    // The public route gates on lifecycle status='published' (public.ts), and
    // the transition matrix only allows draft -> review -> published.
    for (const to of ['review', 'published']) {
      const res = await page.request.post(`/api/pages/${pageId}/status`, { data: { to } });
      expect(res.ok(), `status -> ${to} failed: ${res.status()}`).toBe(true);
    }
    const pub = await page.request.post(`/api/pages/${pageId}/publish`);
    expect(pub.ok(), `publish failed: ${pub.status()}`).toBe(true);
    const { url } = (await pub.json()) as { url: string };
    await page.goto(url);
    await expect(page.getByText('para B')).toBeVisible({ timeout: 15_000 });
    const readerP = await page.evaluate(() => {
      // Find the rendered paragraph for "para B" wherever the reader put it —
      // the guard is about computed style, not DOM shape.
      const p = Array.from(document.querySelectorAll('p')).find(
        (el) => el.textContent?.trim() === 'para B',
      );
      return p ? Number.parseFloat(getComputedStyle(p).marginTop) : null;
    });
    expect(readerP).not.toBeNull();
    expect(readerP).not.toBe(12);
  });
});

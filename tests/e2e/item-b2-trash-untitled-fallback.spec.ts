// v0.10.2 B2 — pages deleted while untitled rendered an EMPTY title line in
// /trash (and /archived): createPage stores title '' (born title-less), and
// no fallback existed anywhere in the listTrash → page → row chain. The fix
// is display-only: the row renders the i18n'd "Untitled" when the stored
// title is empty/whitespace; the stored '' is untouched.
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi } from './util';

test.describe('B2 — trash untitled fallback', () => {
  test('untitled page shows "Untitled" in the trash row', async ({ page, seeded }) => {
    await signIn(page, seeded);
    // Born title-less through the product API (title omitted → DB stores '').
    const pageId = await createPageViaApi(page, '');
    const del = await page.request.delete(`/api/pages/${pageId}`);
    expect(del.ok()).toBeTruthy();

    await page.goto('/trash');
    const row = page.locator('li', {
      has: page.locator(`[data-trash-id="${pageId}"]`),
    });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('Untitled', { exact: true })).toBeVisible();
  });

  test('whitespace-only title also falls back to "Untitled"', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const pageId = await createPageViaApi(page, '   ');
    const del = await page.request.delete(`/api/pages/${pageId}`);
    expect(del.ok()).toBeTruthy();

    await page.goto('/trash');
    const row = page.locator('li', { has: page.locator(`[data-trash-id="${pageId}"]`) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('Untitled', { exact: true })).toBeVisible();
  });

  test('real titles render untouched (guard — no before)', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const title = `B2 real title ${Date.now()}`;
    const pageId = await createPageViaApi(page, title);
    const del = await page.request.delete(`/api/pages/${pageId}`);
    expect(del.ok()).toBeTruthy();

    await page.goto('/trash');
    const row = page.locator('li', { has: page.locator(`[data-trash-id="${pageId}"]`) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText(title, { exact: true })).toBeVisible();
    await expect(row.getByText('Untitled', { exact: true })).toHaveCount(0);
  });

  test('display-only: restoring the untitled page keeps the stored empty title', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const pageId = await createPageViaApi(page, '');
    await page.request.delete(`/api/pages/${pageId}`);

    await page.goto('/trash');
    const row = page.locator('li', { has: page.locator(`[data-trash-id="${pageId}"]`) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: 'Restore' }).click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });

    // The stored title is still '' — the API returns it raw.
    const res = await page.request.get(`/api/pages/${pageId}`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { page?: { title?: string }; title?: string };
    const storedTitle = body.page?.title ?? body.title;
    expect(storedTitle).toBe('');
  });
});

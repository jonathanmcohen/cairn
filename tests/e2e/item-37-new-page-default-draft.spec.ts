// v0.9.18 Gate 3 — runtime spec for carry-forward item #37 (a page created via
// the UI starts in lifecycle status "Draft").
//
// Behavior under guard: the sidebar "New page" button
// (src/components/new-page-button.tsx) POSTs /api/pages and navigates to the
// new page; the page header mounts the lifecycle StatusPicker
// (src/components/pages/status-picker.tsx) whose trigger badge carries
// aria-label "Change status" (i18n pages.status.change), data-status, and the
// localized status text ("Draft" — pages.status.draft). Cross-checked against
// GET /api/pages/<id> returning status 'draft'.
import { expect, signIn, test } from '../a11y/fixtures';

test.describe('item #37 — new page defaults to Draft', () => {
  test('creating a page via the sidebar New page button lands on a Draft page', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');

    const newPageButton = page.getByRole('button', { name: 'New page', exact: true });
    await expect(newPageButton).toBeVisible({ timeout: 30_000 });
    await newPageButton.click();
    await page.waitForURL('**/pages/**', { timeout: 30_000 });

    // UI assertion — the lifecycle badge in the page header shows Draft. For
    // an editor-role user the badge is the StatusPicker popover trigger.
    const statusBadge = page.getByRole('button', { name: 'Change status' });
    await expect(statusBadge).toBeVisible({ timeout: 30_000 });
    await expect(statusBadge).toHaveText('Draft');
    await expect(statusBadge).toHaveAttribute('data-status', 'draft');

    // API cross-check — the created page's stored lifecycle status is 'draft'.
    const match = /\/pages\/([0-9a-f-]{36})/.exec(page.url());
    if (!match?.[1]) throw new Error(`could not extract page id from URL: ${page.url()}`);
    const res = await page.request.get(`/api/pages/${match[1]}`);
    expect(res.ok(), `GET /api/pages/${match[1]} failed: ${res.status()}`).toBe(true);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('draft');
  });
});

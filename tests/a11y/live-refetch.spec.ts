import { expect, signIn, test } from './fixtures';

// v0.9.8 G4 (G) — clicking "New page" must surface the new page in the
// server-rendered sidebar tree within 1s WITHOUT a manual reload. The button
// (src/components/new-page-button.tsx) does router.push + router.refresh; this
// guards the refresh contract. We never call page.reload().
test.describe('live sidebar refetch', () => {
  test('a newly created page appears in the sidebar tree under 1s with no reload', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');

    const newPageButton = page.getByRole('button', { name: 'New page', exact: true });
    await expect(newPageButton).toBeVisible();

    // Baseline count of "Untitled" rows in the sidebar before creating one.
    const untitledRows = page.getByText('Untitled', { exact: true });
    const before = await untitledRows.count();

    const start = Date.now();
    await newPageButton.click();

    // The new page navigates to /pages/<id> and the sidebar re-renders via
    // router.refresh(). Assert one more "Untitled" row appears within 1s.
    await expect
      .poll(() => untitledRows.count(), { timeout: 1000, intervals: [50, 100, 200] })
      .toBeGreaterThan(before);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

// v0.10.2 B1 — database-kind "Use template" stranded the button forever.
// instantiateTemplate never returned the minted host-page id for database
// payloads, so the gallery's success path hit router.refresh() (no
// navigation) and setBusy(null) only ran in the catch — the card button
// stayed disabled on "Working…" until remount while the clone silently
// succeeded. The fix surfaces rootPageId (lib) and releases busy in a
// finally (client).
import { expect, signIn, test } from '../a11y/fixtures';

test.describe('B1 — database-kind template instantiate', () => {
  test('Project tracker lands on the minted host page and releases the button', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/templates');

    const card = page
      .locator('[data-testid="template-card"]', { hasText: 'Project tracker' })
      .first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.getByRole('button', { name: 'Use template' }).click();

    // The whole bug: rootPageId must survive lib → route → client so the
    // browser NAVIGATES. On pre-fix builds the URL stays on /templates.
    await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}/, { timeout: 30_000 });

    // The cloned database renders on the minted host page: the Project
    // tracker built-in's "All tasks" view tab is the loaded-database proof.
    await expect(page.getByText('All tasks').first()).toBeVisible({ timeout: 30_000 });

    // No stranded button: back on the gallery the card is usable again.
    await page.goto('/templates');
    const cardAfter = page
      .locator('[data-testid="template-card"]', { hasText: 'Project tracker' })
      .first();
    const useAfter = cardAfter.getByRole('button', { name: 'Use template' });
    await expect(useAfter).toBeVisible({ timeout: 15_000 });
    await expect(useAfter).toBeEnabled();
  });

  test('error path re-enables the button (finally, not just happy path)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/templates');

    await page.route('**/api/templates/*/instantiate', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'forced failure (spec)' }),
      }),
    );

    const card = page
      .locator('[data-testid="template-card"]', { hasText: 'Project tracker' })
      .first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const use = card.getByRole('button', { name: 'Use template' });
    await use.click();

    // Inline error renders and the button leaves the Working… state. Scoped to
    // the destructive paragraph: P14 added an error toast carrying the same
    // message, so the bare text locator now matches two elements.
    await expect(
      page.locator('p.text-destructive', { hasText: 'forced failure (spec)' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole('button', { name: 'Use template' })).toBeEnabled({
      timeout: 15_000,
    });
  });

  test('page-kind template still navigates (guard — no before)', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/templates');

    const card = page
      .locator('[data-testid="template-card"]', { hasText: 'Meeting notes' })
      .first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: 'Use template' }).click();
    await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}/, { timeout: 30_000 });
  });
});

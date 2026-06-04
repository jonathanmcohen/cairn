import { DARK_INIT } from '../../playwright.config';
import { expect, signIn, test } from './fixtures';

// v0.9.9 Plan F (database depth) e2e smoke. Deferred-run in CI: needs a booted
// app + seeded inline database (tests/a11y/seed.ts writes a `database` node
// into the seeded page pointing at seeded.databaseId).

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'dark') {
    await page.addInitScript(DARK_INIT);
  }
});

test.describe('database depth smoke (Plan F)', () => {
  test('row-detail drawer opens with Properties + Comments tabs; gutter handles present (#241/#245)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto(`/pages/${seeded.pageId}`);
    await page.waitForLoadState('networkidle');

    // The inline database renders its table view.
    const table = page.getByRole('grid').first();
    await expect(table).toBeVisible({ timeout: 15_000 });

    // F3 #245 — hover a row to reveal the left-gutter insert + actions handles.
    const firstRow = page.locator('[data-virtual-row]').first();
    await firstRow.hover();
    await expect(page.getByRole('button', { name: /insert row below/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /row actions/i }).first()).toBeVisible();

    // F1 #241 — the ⋮⋮ menu's "Open" item opens the full row-detail drawer.
    await page
      .getByRole('button', { name: /row actions/i })
      .first()
      .click();
    await page.getByRole('menuitem', { name: /^open$/i }).click();

    // The drawer (shadcn Sheet) shows the Properties + Comments tabs.
    await expect(page.getByRole('tab', { name: /properties/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /comments/i })).toBeVisible();
  });

  test('add-view picker shows the needProperty hint when no date/select property exists (#264)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto(`/pages/${seeded.pageId}`);
    await page.waitForLoadState('networkidle');

    const addView = page.getByRole('combobox', { name: /add view/i }).first();
    await expect(addView).toBeVisible({ timeout: 15_000 });
    await addView.click();
    // The hint row is rendered in the picker footer when no qualifying property
    // exists (the default seed has none). Calendar/Timeline/Board are disabled.
    await expect(page.getByText(/need a date or select property/i)).toBeVisible();
  });
});

import { DARK_INIT } from '../../playwright.config';
import { expectNoA11yViolations } from './axe';
import { expect, signIn, test } from './fixtures';

// Pre-seed the class-based next-themes dark mode for the `dark` project, in
// line with the other a11y specs (CLAUDE.md: theme is class-based, not
// media-query based).
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'dark') {
    await page.addInitScript(DARK_INIT);
  }
});

test.describe('inline database a11y (WCAG 2.1 AA)', () => {
  test('the inline database table view has no violations', async ({ page, seeded }) => {
    await signIn(page, seeded);
    // Cairn has no standalone `/databases/:id` route — databases are inline
    // blocks on a page (CLAUDE.md). The seed in `tests/a11y/seed.ts` writes a
    // `database` node into the page content pointing at `seeded.databaseId`,
    // so loading the page renders the database block.
    await page.goto(`/pages/${seeded.pageId}`);
    await page.waitForLoadState('networkidle');

    // The database block renders its default table view as a real `<table>`
    // (see `src/components/databases/table-view.tsx`). Wait for it before
    // running axe so the surface under audit is actually mounted. The block
    // mounts asynchronously after Yjs sync + a per-block data fetch, so we
    // give it a generous timeout.
    const table = page.getByRole('table').first();
    await expect(table).toBeVisible({ timeout: 15_000 });

    await expectNoA11yViolations(page, 'database table view');
  });
});

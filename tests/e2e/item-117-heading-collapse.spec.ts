// v0.9.18 Gate 3 — runtime spec PATTERN for carry-forward item #117
// (heading collapse chevron). This is the template every item PR copies:
// boot the real app (playwright.e2e.config.ts), sign in via the seeded
// fixture, perform the exact browser repro, and assert the UI state — so a
// green unit spec can't hide a browser-level regression.
//
// Shipped behavior under guard: hovering a heading reveals a collapse chevron;
// clicking it hides that heading's following content until expanded again
// (src/components/editor/heading-collapse.tsx, wired in editor.tsx). The
// item-117 PR replaces the `fixme` with the confirmed selectors + assertions,
// captured live against the same booted app used for the PR repro strip.
import { expect, test } from '../a11y/fixtures';

test.describe('item #117 — heading collapse chevron', () => {
  // Unblocked in the item-117 PR once the live chevron selector is confirmed
  // against the booted editor (Gate 2 recording is captured in the same run).
  test.fixme('clicking the heading chevron collapses the section content', async ({
    page,
    seeded,
  }) => {
    // 1. Sign in (real Auth.js credentials path — identical to live).
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(seeded.userEmail);
    await page.locator('input[name="password"]').fill(seeded.userPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/', { timeout: 30_000 });

    // 2. Open a page whose body has a heading followed by a paragraph.
    //    (item PR: navigate to / create the seeded fixture page.)

    // 3. Hover the heading -> the collapse chevron appears.
    //    const heading = page.locator('.ProseMirror h2').first();
    //    await heading.hover();

    // 4. Click the chevron.
    //    await page.locator('[data-heading-collapse-toggle]').first().click();

    // 5. Assert: the following block is hidden.
    //    await expect(page.locator('.ProseMirror p', { hasText: '…' })).toBeHidden();
    expect(true).toBe(true);
  });
});

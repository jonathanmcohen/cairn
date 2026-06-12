// v0.10.2 P15 — notification drawer footer hides during the empty state.
//
// Behavior under guard: the drawer footer (Mark all read + See all,
// src/components/notifications/drawer.tsx) renders only when the feed has
// items — conditioned on items.length, NOT unread count, so it stays once
// read items exist. This spec drives the real bell → drawer through the
// proxy with the feed route intercepted to pin both states and the
// mark-all-read transition (a static render check can't cover the
// transition):
//   - zero notifications → caught-up copy, NO footer (neither control);
//   - one unread item → footer present, Mark all read works;
//   - after mark-all-read (item still listed, now read) → footer remains.
import { expect, signIn, test } from '../a11y/fixtures';

const FEED = '**/api/notifications?*';

test.describe('item P15 — notification drawer footer on empty state', () => {
  test('empty feed renders the caught-up state with no footer', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.route(FEED, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ notifications: [], unreadCount: 0 }),
      }),
    );
    await page.goto('/');
    await page.getByRole('button', { name: /^Notifications/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('You’re all caught up')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('notification-drawer-footer')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Mark all read' })).toHaveCount(0);
    await expect(dialog.getByRole('link', { name: 'See all' })).toHaveCount(0);
  });

  test('footer shows with items and survives mark-all-read (read items still listed)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    let allRead = false;
    const item = (readAt: string | null) => ({
      notifications: [
        {
          id: 'p15-fixture',
          type: 'mention',
          payload: {},
          readAt,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: readAt ? 0 : 1,
    });
    await page.route(FEED, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(item(allRead ? new Date().toISOString() : null)),
      }),
    );
    await page.route('**/api/notifications/mark-all-read', (route) => {
      allRead = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: /^Notifications/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Mentioned you')).toBeVisible({ timeout: 15_000 });
    const footer = page.getByTestId('notification-drawer-footer');
    await expect(footer).toBeVisible();

    // Mark all read: the SWR revalidate now serves the item as read. The row
    // stays listed, so the footer must remain (items.length, not unread).
    await footer.getByRole('button', { name: 'Mark all read' }).click();
    await expect(dialog.getByRole('button', { name: 'Mark as read' })).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(dialog.getByText('Mentioned you')).toBeVisible();
    await expect(footer).toBeVisible();
    await expect(footer.getByRole('link', { name: 'See all' })).toBeVisible();
  });
});

// v0.10.2 S11 — sign-out confirmation dialog (#80 hardening).
//
// #80 itself (the broken CSRF-less POST → Server Action sign-out) is already
// fixed and proved by auth-signout.spec.ts. This spec guards the NEW layer: a
// themed confirm dialog now gates BOTH sign-out call sites, so a stray click
// can no longer end the session. The dialog names the signed-in account.
//
// The two call sites are intentionally distinct surfaces:
//   1. the sidebar footer (src/components/sidebar-footer-nav.tsx)
//   2. the Settings → Security sessions card (src/components/security/
//      sessions-card.tsx) — a single-site spec would silently miss the second.
//
// Mechanics worth noting for future editors:
//   - The confirm dialog is the shared radix `Dialog` from
//     src/components/ui/confirm-dialog.tsx: role="dialog", accessible name from
//     its `DialogTitle` ("Sign out?"). Its Cancel / action buttons live inside.
//   - The dialog renders in a radix PORTAL (document.body), so scope button
//     lookups to the dialog, not to the sidebar.
//   - The sidebar mounts twice (desktop <aside> + mobile drawer), so the
//     sidebar Sign out button is disambiguated with `.last()` like other specs.
//   - "Survives" / "signed out" are proved by NAVIGATION: a protected route
//     either renders (still authed) or bounces to /login (signed out). goto()
//     follows the redirect chain and completes a real load, so it's the hard
//     proof — not a soft RSC nav.
//
// DEFERRED-TO-CI like the sibling tests/e2e/* specs (a11y fixtures + webServer
// + seed; CI extends testDir/testMatch to include tests/e2e).
import type { Page } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';

const SIDEBAR = '[data-cairn-workspace-sidebar]';
const SIGN_OUT_TITLE = 'Sign out?'; // sidebar.signOutConfirm.title (en)

/** The visible sidebar's Sign out submit button (desktop, via `.last()`). */
function sidebarSignOut(page: Page) {
  return page
    .locator(SIDEBAR)
    .last()
    .getByRole('button', { name: /sign out/i });
}

/** The single-device Sign out button on the Security sessions card. */
function sessionsCardSignOut(page: Page) {
  // "Sign out of this browser" — distinct from "Sign out everywhere else".
  return page.getByRole('button', { name: 'Sign out of this browser' });
}

/** Land on a real post-login state with the sidebar mounted. */
async function settleSignedIn(page: Page, seeded: { pageId: string }) {
  await page.goto(`/pages/${seeded.pageId}`);
  await expect(page.locator(SIDEBAR).last()).toBeVisible({ timeout: 30_000 });
}

/** Assert a protected route still renders (session survives). */
async function expectStillAuthed(page: Page, seeded: { pageId: string }) {
  await page.goto(`/pages/${seeded.pageId}`);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(page.locator(SIDEBAR).last()).toBeVisible({ timeout: 30_000 });
}

/** Assert the session is gone: a protected route bounces to /login. */
async function expectSignedOut(page: Page, seeded: { pageId: string }) {
  await page.goto(`/pages/${seeded.pageId}`);
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
}

test.describe('item S11 — sign-out confirmation dialog (#80 hardening)', () => {
  test('sidebar: Cancel keeps the session; Confirm signs out', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await settleSignedIn(page, seeded);

    // --- Sign out → dialog appears showing the actual signed-in email. ---
    await sidebarSignOut(page).click();
    const dialog = page.getByRole('dialog', { name: SIGN_OUT_TITLE });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // The body names the real account (sidebar.signOutConfirm.body interpolates
    // {email}). seeded.userEmail is the exact seeded credentials-login email.
    await expect(dialog).toContainText(seeded.userEmail);

    // --- Cancel → session SURVIVES. ---
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expectStillAuthed(page, seeded);

    // --- Sign out again → Confirm → signed out, lands on /login. ---
    await sidebarSignOut(page).click();
    const dialog2 = page.getByRole('dialog', { name: SIGN_OUT_TITLE });
    await expect(dialog2).toBeVisible({ timeout: 15_000 });
    await dialog2.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

    // Regression guard: the confirmed sign-out actually cleared the session —
    // a protected route bounces (the end-to-end Server Action path still works).
    await expectSignedOut(page, seeded);
  });

  test('sidebar: Escape closes the dialog without signing out', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await settleSignedIn(page, seeded);

    await sidebarSignOut(page).click();
    const dialog = page.getByRole('dialog', { name: SIGN_OUT_TITLE });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Escape resolves the confirm `false` → no sign-out.
    await expectStillAuthed(page, seeded);
  });

  test('sidebar: shift+click still opens the dialog (no shift-click bypass)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await settleSignedIn(page, seeded);

    // A modifier-click must NOT slip past the dialog into a direct sign-out:
    // the intercept always preventDefaults the first submit and opens the
    // confirm regardless of modifiers.
    await sidebarSignOut(page).click({ modifiers: ['Shift'] });
    const dialog = page.getByRole('dialog', { name: SIGN_OUT_TITLE });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // Still signed in — shift+click opened the dialog, it did not sign out.
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expectStillAuthed(page, seeded);
  });

  test('settings/security card: Cancel keeps the session; Confirm signs out', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    // The sessions card lists devices; wait for the page to settle on it.
    await page.goto('/settings/security');
    const cardSignOut = sessionsCardSignOut(page);
    await expect(cardSignOut).toBeVisible({ timeout: 30_000 });

    // --- Sign out → dialog appears showing the actual signed-in email. ---
    await cardSignOut.click();
    const dialog = page.getByRole('dialog', { name: SIGN_OUT_TITLE });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(seeded.userEmail);

    // --- Cancel → session SURVIVES. ---
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expectStillAuthed(page, seeded);

    // --- Sign out again → Confirm → signed out. ---
    await page.goto('/settings/security');
    const cardSignOut2 = sessionsCardSignOut(page);
    await expect(cardSignOut2).toBeVisible({ timeout: 30_000 });
    await cardSignOut2.click();
    const dialog2 = page.getByRole('dialog', { name: SIGN_OUT_TITLE });
    await expect(dialog2).toBeVisible({ timeout: 15_000 });
    await dialog2.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

    // Regression guard: confirmed sign-out cleared the session end-to-end.
    await expectSignedOut(page, seeded);
  });

  test('settings/security card: Escape closes the dialog without signing out', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/security');
    const cardSignOut = sessionsCardSignOut(page);
    await expect(cardSignOut).toBeVisible({ timeout: 30_000 });

    await cardSignOut.click();
    const dialog = page.getByRole('dialog', { name: SIGN_OUT_TITLE });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expectStillAuthed(page, seeded);
  });
});

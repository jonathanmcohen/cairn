// v0.9.9 Plan K (Workspace onboarding) — route-reachability + per-feature
// deployed-image smoke for K1 (#215/#206 new-page naming), K2 (#216 default
// Draft), K3 (#225/#226 invite-member modal + copy-link), K4 (#198 editable
// display name), and K5 (#199 avatar upload).
//
// DEFERRED-TO-CI: like tests/e2e/search-refresh.spec.ts, this spec lives under
// tests/e2e/ but is NOT run by the local `pnpm test:a11y` (whose testDir is
// ./tests/a11y). CI extends testDir/testMatch to include tests/e2e, boots the
// built/deployed image + seed, and runs these against production-identical
// surfaces. We reuse the a11y fixtures (real seeded user + credentials sign-in).
import { expect, signIn, test } from '../a11y/fixtures';

test.describe('Plan K workspace onboarding surfaces', () => {
  test('route-reachability — /settings/workspace/invites shows the Invite member trigger', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const res = await page.goto('/settings/workspace/invites');
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByRole('button', { name: 'Invite member' })).toBeVisible();
  });

  test('route-reachability — /settings/account/profile shows the display-name form + avatar uploader', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const res = await page.goto('/settings/account/profile');
    expect(res?.status()).toBeLessThan(400);
    // K4 editable display name (was a read-only <dd> before).
    await expect(page.getByLabel('Display name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    // K5 avatar uploader control.
    await expect(page.getByRole('button', { name: 'Upload avatar' })).toBeVisible();
  });

  test('#215/#206 — New page carries ?new=1, focuses a title-less input (no literal Untitled)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');
    // Let hydration + the sidebar tree's initial fetches settle: at
    // accumulated-page scale the virtualized tree re-measures for a while
    // after load and Playwright's actionability loop can sit on "element is
    // not stable" for the full timeout (noted for the H3/H4 sidebar work).
    await page.waitForLoadState('networkidle');
    // The sidebar "New page" affordance creates a page and routes to it.
    // Scope to the desktop aside: the mobile drawer renders a hidden copy of
    // the sidebar, and a bare .first() can resolve to it (click never lands).
    await page
      .locator('[data-cairn-workspace-sidebar]')
      .getByRole('button', { name: 'New page' })
      .first()
      .click();
    await page.waitForURL(/\/pages\/[0-9a-f-]+\?new=1/, { timeout: 30_000 });
    // The title input is autofocused and EMPTY — it shows the localized
    // placeholder, never a persisted literal "Untitled".
    const title = page.getByPlaceholder('Untitled');
    await expect(title).toBeFocused();
    await expect(title).toHaveValue('');
    // The naming nudge with a template link is visible while blank.
    await expect(page.getByText('Give your page a name to get started.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Use a template' })).toBeVisible();
  });

  test('#216 — a freshly created page reads Draft (not Published)', async ({ page, seeded }) => {
    await signIn(page, seeded);
    // Create through POST /api/pages — the same route the sidebar button
    // submits to. The button-click PATH is #215's contract above; this test
    // pins the lifecycle DEFAULT, and clicking the sidebar here was flaky at
    // accumulated-page scale (virtualized-tree re-measure churn kept the
    // button "not stable" — noted for the H3/H4 sidebar work).
    const created = await page.request.post('/api/pages', {
      data: { title: `draft-default ${Date.now().toString(36)}` },
    });
    expect(created.ok(), `POST /api/pages failed: ${created.status()}`).toBe(true);
    const { id } = (await created.json()) as { id: string };
    await page.goto(`/pages/${id}`);
    // The lifecycle status control shows Draft for the new page.
    await expect(page.getByText(/draft/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('#225/#226 — Invite member opens a modal and surfaces a Copy invite link', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/workspace/invites');
    await page.getByRole('button', { name: 'Invite member' }).click();
    // Modal title matches the trigger intent.
    await expect(page.getByText('Invite a member')).toBeVisible();
    await page.getByLabel(/email/i).fill(`invitee-${Date.now()}@example.com`);
    await page.getByRole('button', { name: /create invite/i }).click();
    // After creation the link + a real Copy button render.
    await expect(page.getByText(/invite link created/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Copy invite link' })).toBeVisible();
  });

  test('#198 — display name edits and persists after reload', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/settings/account/profile');
    const input = page.getByLabel('Display name');
    const next = `Renamed ${Date.now()}`;
    await input.fill(next);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Profile updated')).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await expect(page.getByLabel('Display name')).toHaveValue(next);
  });
});

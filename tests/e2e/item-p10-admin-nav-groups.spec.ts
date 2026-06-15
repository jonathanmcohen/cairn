// v0.10.2 P10 — settings Admin nav collapsible sub-groups.
//
// The Admin section's 15 unconditional children (+ flag-gated End-to-end
// encryption) render under six collapsible group headers (Identity / Audit &
// Compliance / Integrations / Quotas / Operations / Billing). A collapsed
// group UNMOUNTS its links (DOM count 0) so the arrow-key ring and tab order
// skip them; the group owning the active route auto-expands on deep link.
import { expect, signIn, test } from '../a11y/fixtures';

const NAV = 'nav[aria-label="Settings sections"]';
const GROUP_SLUGS = ['identity', 'audit', 'integrations', 'quotas', 'operations', 'billing'];

// The 15 unconditional admin child hrefs (src/components/settings/sidebar.tsx).
const UNCONDITIONAL_HREFS = [
  // Identity
  '/settings/admin/users',
  '/settings/admin/sso',
  '/settings/admin/mfa',
  // Audit & Compliance
  '/settings/admin/audit',
  '/settings/admin/siem',
  // Integrations
  '/settings/admin/webhooks',
  '/settings/admin/chat-bridge',
  '/settings/admin/federated',
  '/settings/admin/oauth-clients',
  // Quotas
  '/settings/admin/api-keys',
  '/settings/admin/storage',
  // Operations
  '/settings/admin/email',
  '/settings/admin/schedules',
  '/settings/admin/object-storage',
  '/settings/admin/backups',
  '/settings/admin/health',
  '/settings/admin/migrations',
  // Billing
  '/settings/admin/upgrade',
];
// Present only when the NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION build flag is
// on — the spec can't see the server's build env, so it's tolerated, not
// required.
const OPTIONAL_HREFS = ['/settings/admin/encryption'];

test.describe('item P10 — admin nav collapsible sub-groups', () => {
  test('(a) enumerated admin link set: every href exactly once across all six groups', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/admin/audit');
    const nav = page.locator(NAV);
    await expect(nav).toBeVisible({ timeout: 15_000 });

    const collected: string[] = [];
    for (const slug of GROUP_SLUGS) {
      const header = nav.getByTestId(`admin-group-${slug}`);
      await expect(header).toBeVisible({ timeout: 15_000 });
      // The audit group auto-expanded (active route); expand the rest.
      if ((await header.getAttribute('aria-expanded')) === 'false') {
        await header.click();
        await expect(header).toHaveAttribute('aria-expanded', 'true');
      }
      const panelId = await header.getAttribute('aria-controls');
      expect(panelId, `aria-controls on admin-group-${slug}`).toBeTruthy();
      const hrefs = await page
        .locator(`#${panelId} a[data-settings-nav]`)
        .evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''));
      expect(hrefs.length, `group ${slug} has links`).toBeGreaterThan(0);
      collected.push(...hrefs);
    }

    // No duplicates anywhere (catches a child mapped into two groups).
    expect(new Set(collected).size, `duplicate hrefs in ${collected.join(', ')}`).toBe(
      collected.length,
    );
    // Every unconditional href is present (catches drops in the regrouping).
    for (const href of UNCONDITIONAL_HREFS) {
      expect(collected, `missing ${href}`).toContain(href);
    }
    // Anything beyond the 15 must be the flag-gated encryption entry.
    const extras = collected.filter((h) => !UNCONDITIONAL_HREFS.includes(h));
    for (const extra of extras) {
      expect(OPTIONAL_HREFS, `unexpected admin link ${extra}`).toContain(extra);
    }
  });

  test('(b) collapsing Identity unmounts its links; re-expanding restores them', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    // Deep link into an Identity page so the group starts expanded.
    await page.goto('/settings/admin/users');
    const nav = page.locator(NAV);
    const header = nav.getByTestId('admin-group-identity');
    await expect(header).toBeVisible({ timeout: 15_000 });
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    const members = nav.locator('a[data-settings-nav][href="/settings/admin/users"]');
    const sso = nav.locator('a[data-settings-nav][href="/settings/admin/sso"]');
    await expect(members).toHaveCount(1);
    await expect(sso).toHaveCount(1);

    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    // Unmounted, not visually hidden — count drops to 0.
    await expect(members).toHaveCount(0);
    await expect(sso).toHaveCount(0);

    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(members).toHaveCount(1);
    await expect(sso).toHaveCount(1);
  });

  test('(c) deep link to /settings/admin/storage auto-expands Quotas with aria-current on Storage', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/admin/storage');
    const nav = page.locator(NAV);
    await expect(nav.getByTestId('admin-group-quotas')).toHaveAttribute('aria-expanded', 'true', {
      timeout: 15_000,
    });
    const storage = nav.locator('a[data-settings-nav][href="/settings/admin/storage"]');
    await expect(storage).toBeVisible();
    await expect(storage).toHaveAttribute('aria-current', 'page');
    // Sibling groups stay collapsed: headers say so and their links are gone.
    await expect(nav.getByTestId('admin-group-identity')).toHaveAttribute('aria-expanded', 'false');
    await expect(nav.locator('a[data-settings-nav][href="/settings/admin/sso"]')).toHaveCount(0);
  });

  test('(d) ArrowDown from the last link still wraps to the back-to-workspace link', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/admin/audit');
    const nav = page.locator(NAV);
    const security = nav.getByRole('link', { name: 'Security' });
    await expect(security).toBeVisible({ timeout: 15_000 });
    await security.focus();
    await page.keyboard.press('ArrowDown');
    // The back-to-workspace link leads the nav, so wrap lands there.
    await expect(nav.locator('[data-testid="settings-back-to-workspace"]')).toBeFocused();
  });
});

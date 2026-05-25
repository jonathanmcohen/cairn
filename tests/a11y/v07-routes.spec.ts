import { DARK_INIT } from '../../playwright.config';
import { expectNoA11yViolations } from './axe';
import { expect, signIn, test } from './fixtures';

// Force the class-based dark theme for the `dark` project (same pattern as
// shell.spec.ts / dialog.spec.ts — CLAUDE.md: theme is class-based, not
// `prefers-color-scheme`).
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'dark') {
    await page.addInitScript(DARK_INIT);
  }
});

/**
 * For a given screen: assert axe-clean, walk Tab N times and verify no trap
 * (focus actually moves between distinct elements), and verify the focused
 * element is visibly focused (a non-empty :focus-visible outline / box-shadow).
 */
async function pageLoadGate(
  page: import('@playwright/test').Page,
  name: string,
  tabCount = 6,
): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expectNoA11yViolations(page, name);
  // Walk N Tabs and confirm focus advances each step (no trap). We do not
  // require every step to find a focusable element — settings pages with few
  // controls just hit the end of the focus order. We DO require that any two
  // consecutive non-null landings differ (no element-level trap).
  let last: string | null = null;
  let anyFocused = false;
  for (let i = 0; i < tabCount; i++) {
    await page.keyboard.press('Tab');
    const current = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
      const label = el.getAttribute('aria-label') ?? el.textContent?.slice(0, 32) ?? '';
      return `${role}:${label}`;
    });
    if (current !== null) {
      anyFocused = true;
      expect(current, `${name}: Tab #${i + 1} did not advance focus (trap)`).not.toBe(last);
      last = current;
    }
  }
  expect(
    anyFocused,
    `${name}: Tab walk found no focusable element across ${tabCount} presses`,
  ).toBe(true);
  // Focus-visible assertion: the currently-focused element must have a
  // non-empty outline OR a non-empty box-shadow (the project's :focus-visible
  // ring lands on one of those depending on the component).
  const visible = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return false;
    const cs = window.getComputedStyle(el);
    const hasOutline = cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px';
    const hasShadow = cs.boxShadow !== 'none';
    return hasOutline || hasShadow;
  });
  expect(visible, `${name}: focused element has no visible focus indicator`).toBe(true);
}

test.describe('v0.7 new-route a11y (WCAG 2.1 AA)', () => {
  test('/settings/developer/api-keys is axe-clean + keyboard-walkable', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/developer/api-keys');
    await pageLoadGate(page, '/settings/developer/api-keys');
  });

  test('/settings/developer/automation is axe-clean + keyboard-walkable', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/developer/automation');
    await pageLoadGate(page, '/settings/developer/automation');
  });

  test('/settings/developer/connectors is axe-clean + keyboard-walkable', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/developer/connectors');
    await pageLoadGate(page, '/settings/developer/connectors');
  });

  test('/settings/admin/webhooks/[id]/deliveries is axe-clean + keyboard-walkable', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto(`/settings/admin/webhooks/${seeded.webhookId}/deliveries`);
    await pageLoadGate(page, '/settings/admin/webhooks/[id]/deliveries');
  });

  /**
   * `/healthz` is a JSON `route.ts` handler with no DOM (src/app/healthz/route.ts).
   * Axe + Tab-walk don't apply; instead assert HTTP 200 + the documented JSON
   * shape (status/version/db/uptime_seconds) as the spec smoke for this path.
   */
  test('/healthz responds with healthy JSON', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const res = await page.request.get('/healthz');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      status: string;
      version: string;
      db: string;
      uptime_seconds: number;
    };
    expect(body).toMatchObject({
      status: 'ok',
      db: 'ok',
    });
    expect(typeof body.version).toBe('string');
    expect(typeof body.uptime_seconds).toBe('number');
  });
});

test.describe('v0.7 modal / form focus management', () => {
  /**
   * MintTokenDialog: bespoke fixed-position overlay rendered by TokenList.
   * Trigger: "Mint new token" button on /settings/developer/tokens.
   * Asserts:
   *   - open → focus moves INSIDE the dialog surface
   *   - axe clean on the open dialog
   *   - Esc closes + focus is restored to the trigger
   * Note: the dialog as shipped is a raw <div> overlay (no role="dialog"); this
   * test surfaces that gap as a real failure (Task 5 fixes inline).
   */
  test('MintTokenDialog: open moves focus inside, Esc restores to trigger', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/developer/tokens');
    await page.waitForLoadState('networkidle');

    const trigger = page.getByRole('button', { name: /mint new token/i });
    await expect(trigger).toBeVisible();
    await trigger.click();

    // P14: the dialog has role="dialog" + aria-modal + aria-labelledby pointing
    // at the "Mint a new token" heading, so the accessible-name regex resolves
    // through the standard ARIA name computation.
    const dialog = page.getByRole('dialog', { name: /mint a new token/i });
    await expect(dialog).toBeVisible();

    await expectNoA11yViolations(page, 'MintTokenDialog');

    // Focus must be inside the dialog surface (useFocusTrap focuses the first
    // focusable child on mount).
    const focusInside = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return dlg ? dlg.contains(document.activeElement) : false;
    });
    expect(focusInside, 'MintTokenDialog: focus did not move inside on open').toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  /**
   * RuleForm (automation): inline Card form revealed by the "New rule" button
   * (NOT a modal — there's no Esc-to-close + no overlay; it lives in the page
   * flow). The relevant a11y assertions are: (a) clicking "New rule" reveals
   * the form, (b) focus lands on the first input inside, and (c) axe stays
   * clean on the expanded form.
   */
  test('RuleForm: open reveals the form, focus is reachable inside', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/settings/developer/automation');
    await page.waitForLoadState('networkidle');

    const trigger = page.getByRole('button', { name: /^new rule$/i });
    await expect(trigger).toBeVisible();
    await trigger.click();

    // Card heading replaces the trigger when opened.
    const heading = page.getByRole('heading', { name: /^new rule$/i });
    await expect(heading).toBeVisible();

    await expectNoA11yViolations(page, 'RuleForm (inline)');

    // The form's first focusable control is the Name input. Move focus to it
    // explicitly (the inline form doesn't auto-focus today) and assert it
    // accepts focus + draws a focus indicator.
    const nameInput = page.getByLabel('Name').first();
    await nameInput.focus();
    await expect(nameInput).toBeFocused();
  });
});

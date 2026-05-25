import { devices } from '@playwright/test';
import { expectNoA11yViolations } from './axe';
import { expect, signIn, test } from './fixtures';

// WCAG 2.5.5 Target Size (Enhanced) minimum: 44×44 CSS px for any pointer-input
// target. Mobile viewport (iPhone SE-ish) is the worst case for our v0.7
// surfaces — dense settings tables + chip rows that often shrink below 44.
test.use({ ...devices['iPhone SE'] });

const V07_ROUTES_NEEDING_PARAM: Record<string, (seeded: { webhookId?: string }) => string> = {
  '/settings/admin/webhooks/:id/deliveries': (s) =>
    s.webhookId ? `/settings/admin/webhooks/${s.webhookId}/deliveries` : '/settings/admin/webhooks',
};

const V07_ROUTES: string[] = [
  '/settings/developer',
  '/settings/automation',
  '/settings/connectors',
  '/settings/admin/webhooks/:id/deliveries',
];

const INTERACTIVE_SELECTOR =
  'button, a, [role="button"], [role="link"], input:not([type="hidden"]), select, textarea';

for (const routeTemplate of V07_ROUTES) {
  test(`touch targets >= 44x44 on ${routeTemplate}`, async ({ page, seeded }) => {
    await signIn(page, seeded);
    const concrete = V07_ROUTES_NEEDING_PARAM[routeTemplate]
      ? V07_ROUTES_NEEDING_PARAM[routeTemplate](seeded as { webhookId?: string })
      : routeTemplate;
    await page.goto(concrete);
    await page.waitForLoadState('networkidle');

    // axe pass first — gives readable a11y failures if any.
    await expectNoA11yViolations(page, `touch-target route ${routeTemplate}`);

    // Then the touch-target rule: every visible interactive element must be ≥ 44×44.
    const violations = await page.$$eval(INTERACTIVE_SELECTOR, (els) => {
      const out: Array<{ tag: string; cls: string; w: number; h: number }> = [];
      for (const el of els) {
        const r = (el as HTMLElement).getBoundingClientRect();
        // Skip off-screen / hidden / collapsed elements.
        if (r.width === 0 || r.height === 0) continue;
        const style = getComputedStyle(el as HTMLElement);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        if (r.width < 44 || r.height < 44) {
          out.push({
            tag: (el as HTMLElement).tagName.toLowerCase(),
            cls: ((el as HTMLElement).className ?? '').toString().slice(0, 60),
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        }
      }
      return out;
    });

    expect(violations, `route ${routeTemplate}: ${violations.length} sub-44 touch targets`).toEqual(
      [],
    );
  });
}

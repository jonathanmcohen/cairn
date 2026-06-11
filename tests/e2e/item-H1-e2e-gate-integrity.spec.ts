// v0.10.0 H1 — legacy e2e de-rot: gate-integrity meta-spec.
//
// H1 widened the CI e2e gate from `tests/e2e/item-*` to the whole dir after
// de-rotting the legacy specs. This spec pins the two properties that make
// that gate trustworthy:
//   (a) the axe zero-violation assertion still goes RED on a NEW violation —
//       a contrived WCAG failure injected into a live page must be detected
//       (guards against the gate decaying into a rubber stamp);
//   (b) the same page WITHOUT the contrived violation passes — the detector
//       fires on real signal, not unconditionally.
import AxeBuilder from '@axe-core/playwright';
import { expect, signIn, test } from '../a11y/fixtures';

/** WCAG 2.1 A/AA tags — mirrors tests/a11y/axe.ts (the CI gate's scope). */
const WCAG_21_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('item H1 — e2e gate integrity', () => {
  test('(a) the axe gate detects a contrived violation (button without a name)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/inbox');
    await expect(page.locator('[data-tour="sidebar"]')).toBeVisible({ timeout: 15_000 });

    // Inject a deliberate WCAG failure: a visible button with NO accessible
    // name. Pure-DOM on purpose — an earlier missing-alt <img> variant used a
    // data: URI that CI's CSP blocked, and axe excludes the unloaded
    // (effectively invisible) element, so the meta-test passed locally and
    // failed on the runner.
    await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.id = 'h1-contrived-violation';
      btn.type = 'button';
      btn.style.cssText = 'width:24px;height:24px;';
      document.querySelector('main')?.appendChild(btn);
    });

    const results = await new AxeBuilder({ page }).withTags(WCAG_21_AA_TAGS).analyze();
    const buttonName = results.violations.find((v) => v.id === 'button-name');
    expect(
      buttonName,
      'the axe gate failed to flag a nameless button — the zero-violation assertion has decayed',
    ).toBeTruthy();
  });

  test('(b) the same page without the contrived violation passes the axe gate', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/inbox');
    await expect(page.locator('[data-tour="sidebar"]')).toBeVisible({ timeout: 15_000 });

    const results = await new AxeBuilder({ page }).withTags(WCAG_21_AA_TAGS).analyze();
    const summary = results.violations.map((v) => ({ id: v.id, help: v.help }));
    expect(summary, '/inbox must be clean — the detector should fire on signal only').toEqual([]);
  });
});

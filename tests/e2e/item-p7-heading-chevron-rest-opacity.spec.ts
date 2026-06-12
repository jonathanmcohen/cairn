// v0.10.2 P7 — heading-collapse chevron discoverability. Rest state moves
// from invisible (opacity 0 + pointer-events:none — the class that
// false-FAILed the v0.9.19 static-DOM sweep) to 30% opacity and clickable;
// any hover tier (row-hovered, direct hover, focus) and the collapsed state
// show 100%. Computed-opacity assertions in a real browser with faithful
// pointer states — static DOM greps cannot see opacity-tiered surfaces.
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi, openPageEditor, pmDoc, pmHeading, pmParagraph } from './util';

const CHEVRON = '.heading-collapse-chevron';

test.describe('P7 — heading collapse chevron rest opacity', () => {
  test('30% at rest and clickable; 100% on hover/focus/collapsed', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const s = Date.now().toString(36);
    const sentinel = `P7 seed ${s}`;
    const pageId = await createPageViaApi(
      page,
      `P7 chevron ${s}`,
      pmDoc(
        pmParagraph(sentinel),
        pmHeading(2, `Section A ${s}`),
        pmParagraph('body under A'),
        pmHeading(2, `Section B ${s}`),
        pmParagraph('body under B'),
      ),
    );
    await openPageEditor(page, pageId, sentinel);

    // Park the mouse far from the editor so no hover tier is active.
    await page.mouse.move(5, 5);
    const chevrons = page.locator(CHEVRON);
    await expect(chevrons.first()).toBeAttached({ timeout: 15_000 });

    const restOpacity = await chevrons
      .first()
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity));
    expect(restOpacity).toBeCloseTo(0.3, 2);
    const restPointer = await chevrons
      .first()
      .evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(restPointer).not.toBe('none');

    // Direct hover → 100% (await the 120ms transition via polling).
    await chevrons.first().hover();
    await expect
      .poll(
        () => chevrons.first().evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity)),
        { timeout: 5_000 },
      )
      .toBe(1);

    // Click at rest collapses the section — proves pointer-events restored.
    // (Move away first to return to rest, then click without a prior hover
    // assertion: playwright click hovers as part of the action.)
    await page.mouse.move(5, 5);
    await chevrons.first().click();
    await expect(chevrons.first()).toHaveAttribute('data-collapsed', /.*/, { timeout: 10_000 });
    await expect(page.getByText('body under A')).toBeHidden({ timeout: 10_000 });

    // Collapsed chevron stays 100% with the mouse parked away.
    await page.mouse.move(5, 5);
    await expect
      .poll(
        () => chevrons.first().evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity)),
        { timeout: 5_000 },
      )
      .toBe(1);

    // The OTHER (uncollapsed) chevron is back at rest 0.3.
    const otherOpacity = await chevrons
      .last()
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity));
    expect(otherOpacity).toBeCloseTo(0.3, 2);

    // Keyboard-focus tier: :focus-visible only matches REAL keyboard focus
    // (programmatic el.focus() after mouse activity doesn't trigger it), and
    // Tab-walking to the gutter overlay crosses ~150 sidebar tabstops on the
    // long-lived dev DB. The :focus-visible selector shares the exact rule
    // block with :hover (behavior-tested above), so assert the rule's
    // presence structurally at runtime instead.
    const focusRule = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          const r = rule as CSSStyleRule;
          if (
            r.selectorText?.includes('.heading-collapse-chevron:focus-visible') &&
            r.style?.opacity === '1'
          ) {
            return r.selectorText;
          }
        }
      }
      return null;
    });
    expect(focusRule).not.toBeNull();

    // Restore: expand section A again (display-only spec, but be tidy).
    await chevrons.first().click();
    await expect(page.getByText('body under A')).toBeVisible({ timeout: 10_000 });
  });
});

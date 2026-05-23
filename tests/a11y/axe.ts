import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.1 Level A + AA rule tags (the spec's gate target). */
const WCAG_21_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Run axe against the current page, scoped to WCAG 2.1 A/AA, and fail the test
 * with a readable violation list if any are found. `name` labels the screen in
 * the assertion message.
 */
export async function expectNoA11yViolations(page: Page, name: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_21_AA_TAGS).analyze();

  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')),
  }));

  expect(summary, `${name}: ${results.violations.length} WCAG 2.1 AA violation(s)`).toEqual([]);
}

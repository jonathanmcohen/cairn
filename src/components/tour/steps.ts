/**
 * v0.10.0 F3 — the onboarding tour's step list. Each step anchors to a stable
 * `data-tour` hook on a real UI element (sidebar, search button, topbar action
 * group, page menu, help/replay button). Steps whose anchor is not mounted on
 * the current route (e.g. the page menu on the home route) are skipped, not
 * shown detached — see `nextMountedStep`.
 */

export type TourPlacement = 'top' | 'right' | 'bottom' | 'left';

export type TourStep = {
  id: string;
  /** CSS selector for the anchor element (a `[data-tour="…"]` hook). */
  anchor: string;
  titleKey: string;
  bodyKey: string;
  placement: TourPlacement;
};

export const STEPS: readonly TourStep[] = [
  {
    id: 'sidebar',
    anchor: '[data-tour="sidebar"]',
    titleKey: 'tour.step.sidebar.title',
    bodyKey: 'tour.step.sidebar.body',
    placement: 'right',
  },
  {
    id: 'search',
    anchor: '[data-tour="search"]',
    titleKey: 'tour.step.search.title',
    bodyKey: 'tour.step.search.body',
    placement: 'right',
  },
  {
    id: 'topbar',
    anchor: '[data-tour="topbar"]',
    titleKey: 'tour.step.topbar.title',
    bodyKey: 'tour.step.topbar.body',
    placement: 'bottom',
  },
  {
    id: 'pageMenu',
    anchor: '[data-tour="page-menu"]',
    titleKey: 'tour.step.pageMenu.title',
    bodyKey: 'tour.step.pageMenu.body',
    placement: 'bottom',
  },
  {
    id: 'help',
    anchor: '[data-tour="help"]',
    titleKey: 'tour.step.help.title',
    bodyKey: 'tour.step.help.body',
    placement: 'right',
  },
];

/**
 * Pure skip-unmounted-anchor walker. Returns the index of the next step (in
 * `direction`, default forward) whose anchor `isMounted`, starting AFTER
 * `fromIndex`; -1 when none remain. `fromIndex = -1` finds the first mounted
 * step of the whole list.
 */
export function nextMountedStep(
  steps: readonly TourStep[],
  fromIndex: number,
  isMounted: (selector: string) => boolean,
  direction: 1 | -1 = 1,
): number {
  for (let i = fromIndex + direction; i >= 0 && i < steps.length; i += direction) {
    const step = steps[i];
    if (step && isMounted(step.anchor)) return i;
  }
  return -1;
}

/**
 * Progress over MOUNTED steps only, so a skipped anchor doesn't leave a hole
 * in the "n / total" counter (home route: 4 mounted of 5 → "1 / 4" … "4 / 4").
 * The current step counts as mounted by definition (it is being shown).
 */
export function mountedProgress(
  steps: readonly TourStep[],
  index: number,
  isMounted: (selector: string) => boolean,
): { current: number; total: number } {
  let current = 0;
  let total = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    if (i === index || isMounted(step.anchor)) {
      total++;
      if (i <= index) current++;
    }
  }
  return { current, total };
}

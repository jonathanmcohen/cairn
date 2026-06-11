// v0.10.0 E2 — in-app What's-new panel, opened from the sidebar version chip.
//
// The panel renders the CURRENT version's CHANGELOG section from a build-time
// generated module (scripts/generate-release-notes.mjs →
// src/lib/release-notes/notes.generated.ts). Because the section travels as an
// imported module — not an fs.readFile of CHANGELOG.md at request time — it
// survives `output: 'standalone'`: test (b)'s content assertion passing
// against the production standalone image IS the proof (CHANGELOG.md does not
// exist inside the image).
//
// Tests:
//  (a) seen-marker lifecycle: fresh context (empty localStorage) shows the
//      badge dot on the chip → open panel → close marks seen → badge gone →
//      reload → still gone.
//  (b)+(d) branch-correct content, decided from the REPO STATE at run time
//      (specs run in node — fs allowed): if CHANGELOG.md has a section heading
//      for the running package.json version, that section's heading must
//      render (and no stale older-version heading); otherwise the graceful
//      "notes not available yet" fallback must render. Exact-match selection
//      is what test (d) pins: a dev build ahead of tags must never show an
//      older version's notes.
//  (c) all roles: a VIEWER member (strictest role) sees the chip, the badge,
//      and the panel — no admin gate anywhere in the path.
//
// Determinism notes (persistent e2e dev DB): the seen-marker lives in
// localStorage, which is per-Playwright-context and always fresh — no DB
// cleanup needed. The second user is seeded idempotently by email (same
// pattern as item-D6).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';

type PwPage = import('@playwright/test').Page;

// Playwright runs from the repo root (same precedent as item-D4).
const repoRoot = process.cwd();
const appVersion = (
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }
).version;
const changelog = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8');

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Same exact-match heading rule as scripts/generate-release-notes.mjs:
 * `## [<version>] - <date>` (Keep a Changelog) or a bare `## <version>`.
 * Captures the full heading text after `## ` so the spec can assert the
 * EXACT heading the panel is expected to render.
 */
const v = escapeRegExp(appVersion);
const sectionHeadingMatch = changelog.match(
  new RegExp(`^##\\s+((?:\\[${v}\\]|${v})(?:\\s+.*)?)\\s*$`, 'm'),
);
const currentHeadingText = sectionHeadingMatch?.[1]?.trim() ?? null;

/** Latest OTHER released version in the changelog — the stale-notes canary. */
const staleVersion = [...changelog.matchAll(/^##\s+\[?(\d+\.\d+\.\d+)\]?/gm)]
  .map((m) => m[1])
  .find((ver) => ver !== appVersion);

// Exact en copy from messages/en.json (the e2e harness runs the en locale).
const CLOSE_LABEL = 'Close release notes';
const FALLBACK_COPY = "Release notes for this version aren't available yet.";
const TITLE = `What's new in v${appVersion}`;

/**
 * Open the panel via the chip. The click is retried inside toPass because a
 * click landing before hydration is silently lost (no listener yet) — by the
 * time the panel is visible, hydration + the badge effect have provably run.
 */
async function openPanel(page: PwPage): Promise<void> {
  const chip = page.getByTestId('whats-new-chip');
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await expect(async () => {
    await chip.click({ timeout: 2_000 });
    await expect(page.getByTestId('whats-new-panel')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/** Branch-correct content assertion — see header comment, tests (b)+(d). */
async function expectBranchCorrectNotes(page: PwPage): Promise<void> {
  const panel = page.getByTestId('whats-new-panel');
  await expect(panel.getByRole('heading', { name: TITLE })).toBeVisible();
  if (currentHeadingText !== null) {
    // Section exists for the running version → its heading renders, sourced
    // from the standalone-bundled module (test (b)'s proof), and the fallback
    // does not.
    await expect(
      panel.getByRole('heading', { name: currentHeadingText, exact: true }),
    ).toBeVisible();
    await expect(panel.getByTestId('whats-new-fallback')).toHaveCount(0);
  } else {
    // Running version is ahead of every CHANGELOG section → graceful fallback,
    // never an older section.
    await expect(panel.getByTestId('whats-new-fallback')).toBeVisible();
    await expect(panel.getByTestId('whats-new-fallback')).toHaveText(FALLBACK_COPY);
  }
  // (d) no stale notes in EITHER branch: the most recent OTHER version's
  // heading must not be rendered.
  if (staleVersion) {
    await expect(
      panel.getByRole('heading', { name: new RegExp(`\\[?${escapeRegExp(staleVersion)}\\]?\\s`) }),
    ).toHaveCount(0);
  }
}

test.describe('item E2 — What’s-new panel + per-user seen badge', () => {
  test('(a) seen-marker: badge on first load, open→close marks seen, badge stays gone across reload', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');

    const chip = page.getByTestId('whats-new-chip');
    const badge = page.getByTestId('whats-new-badge');
    await expect(chip).toBeVisible({ timeout: 15_000 });
    // The chip shows the DEPLOYED version — pinning it to the repo's
    // package.json keeps the fs-derived branch choice in (b)+(d) honest.
    await expect(chip).toContainText(`v${appVersion}`);
    // Fresh context = empty localStorage = unseen → badge dot renders.
    await expect(badge).toBeVisible({ timeout: 15_000 });

    await openPanel(page);
    // The old chip affordance (external GitHub release link) lives on in the
    // panel footer.
    await expect(page.getByTestId('whats-new-github')).toHaveAttribute(
      'href',
      `https://github.com/jonathanmcohen/cairn/releases/tag/v${appVersion}`,
    );

    // Close → marks seen → badge leaves the DOM.
    await page.getByRole('button', { name: CLOSE_LABEL }).click();
    await expect(page.getByTestId('whats-new-panel')).not.toBeVisible();
    await expect(badge).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('cairn:whats-new-seen'))).toBe(
      appVersion,
    );

    // Reload: marker persisted → still no badge. Re-opening the panel first
    // proves hydration ran (the badge is rendered by a client effect, so a
    // count-0 assert against a pre-hydration DOM would be vacuous). Opening
    // does NOT mark seen — only closing does — so the badge would be in the
    // DOM here if the marker had been lost.
    await page.reload();
    await openPanel(page);
    await expect(badge).toHaveCount(0);
  });

  test('(b)+(d) panel renders the CURRENT version’s CHANGELOG section from the standalone bundle — or the graceful fallback, never stale notes', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');
    await openPanel(page);
    await expectBranchCorrectNotes(page);
  });

  test('(c) viewer role: chip, badge, and panel all work — not admin-gated', async ({
    browser,
    seeded,
  }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for the e2e harness');
    const member = await seedSecondUser(databaseUrl, {
      workspaceId: seeded.workspaceId,
      email: 'e2-member@cairn.test',
      password: 'e2-member-password-1',
      role: 'viewer',
    });
    const { context, page } = await signInSecondUser(browser, member);
    try {
      await page.goto('/');
      await expect(page.getByTestId('whats-new-chip')).toBeVisible({ timeout: 15_000 });
      // The badge is per-user/per-browser: the viewer's fresh context is unseen.
      await expect(page.getByTestId('whats-new-badge')).toBeVisible({ timeout: 15_000 });
      await openPanel(page);
      await expectBranchCorrectNotes(page);
    } finally {
      await context.close();
    }
  });
});

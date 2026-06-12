// v0.10.2 item P5 — citation superscript ref + hover popover from persisted
// node attrs.
//
// Contract under test:
//  - (a) citation nodes render as numbered superscript chips `[n]` (n = the
//    citation's 1-based dedup'd order in the doc — the bibliography's order),
//    NOT as the full formatted string inline;
//  - (b) hovering a chip opens a popover with the author + year line and the
//    title snippet; mouse-out closes it; keyboard focus reopens it (a11y
//    parity) and Escape closes it;
//  - (c) the popover reads ONLY persisted attrs — with the lookup route
//    aborted at the network layer it still renders (cache proof);
//  - (d) the attrs round-trip a reload through the stored doc;
//  - (e) the real `/cite-doi` slash flow (Cross-Ref mocked at the network
//    layer) inserts a chip whose popover shows the mocked author/year;
//  - (f) the published public page (/p/<slug>) renders the same chip path —
//    superscript chip + popover, full entries only in the bibliography, whose
//    order matches the chip numbers.
//
// Hygiene (persistent e2e dev DB): unique titles/DOIs per run via `stamp()`;
// expect(page).toHaveURL over waitForURL; scrollIntoViewIfNeeded before
// chip interactions (never needed on virtualized sidebar rows here).
import { expect, signIn, test } from '../a11y/fixtures';
import {
  createPageViaApi,
  openPageEditor,
  pmDoc,
  pmParagraph,
  typeSlashQueryAtDocEnd,
} from './util';

type PwPage = import('@playwright/test').Page;

function stamp(): string {
  return `p5${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** ProseMirror JSON citation node carrying the full P5 persisted meta. */
function pmCitation(
  id: string,
  opts: {
    author: string;
    title: string;
    year: number;
    formatted: string;
    journal?: string;
    doi?: string;
    url?: string;
  },
): Record<string, unknown> {
  return {
    type: 'citation',
    attrs: {
      id,
      doi: opts.doi ?? null,
      pubmed_id: null,
      formatted_apa: opts.formatted,
      formatted_mla: opts.formatted,
      formatted_chicago: opts.formatted,
      raw_authors: [opts.author],
      raw_title: opts.title,
      raw_year: opts.year,
      journal: opts.journal ?? null,
      volume: null,
      issue: null,
      pages: null,
      url: opts.url ?? null,
    },
  };
}

/** Seed a page with a sentinel paragraph + two fully-attributed citations. */
async function seedTwoCitationPage(page: PwPage, s: string) {
  const sentinel = `P5 sentinel ${s}`;
  const alpha = {
    author: 'Smith, J.',
    title: `Alpha study ${s}`,
    year: 2021,
    formatted: `Smith, J. (2021). Alpha study ${s}.`,
    journal: 'Journal of Alpha',
    doi: `10.1234/alpha-${s}`,
    url: `https://doi.org/10.1234/alpha-${s}`,
  };
  const beta = {
    author: 'Doe, R.',
    title: `Beta study ${s}`,
    year: 2022,
    formatted: `Doe, R. (2022). Beta study ${s}.`,
    journal: 'Journal of Beta',
    doi: `10.1234/beta-${s}`,
    url: `https://doi.org/10.1234/beta-${s}`,
  };
  const pageId = await createPageViaApi(
    page,
    `P5 citations ${s}`,
    pmDoc(pmParagraph(sentinel), pmCitation(`cit-a-${s}`, alpha), pmCitation(`cit-b-${s}`, beta)),
  );
  return { pageId, sentinel, alpha, beta };
}

const POPOVER = '[data-testid="citation-popover"]';

test.describe('item P5 — citation superscript chip + attrs-only popover', () => {
  test('(a) two seeded citations render [1] and [2] in document (bibliography) order', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const s = stamp();
    const { pageId, sentinel, alpha, beta } = await seedTwoCitationPage(page, s);
    const editor = await openPageEditor(page, pageId, sentinel);

    const chip1 = editor.getByLabel('Citation 1');
    const chip2 = editor.getByLabel('Citation 2');
    await expect(chip1).toBeVisible({ timeout: 15_000 });
    await expect(chip2).toBeVisible({ timeout: 15_000 });
    await expect(chip1).toHaveText('[1]');
    await expect(chip2).toHaveText('[2]');

    // The full formatted strings are popover-only now — never inline.
    await expect(editor).not.toContainText(alpha.formatted);
    await expect(editor).not.toContainText(beta.formatted);

    // Number ↔ entry mapping follows document order (= bibliography order,
    // pinned by the numberCitations/aggregateCitations unit tests): chip 1 is
    // the Alpha citation, chip 2 the Beta one.
    await chip1.scrollIntoViewIfNeeded();
    await chip1.hover();
    await expect(page.locator(POPOVER)).toContainText(alpha.title, { timeout: 10_000 });
    await page.mouse.move(0, 0);
    await expect(page.locator(POPOVER)).toHaveCount(0, { timeout: 10_000 });
    await chip2.hover();
    await expect(page.locator(POPOVER)).toContainText(beta.title, { timeout: 10_000 });
  });

  test('(b)+(c) hover/focus popover renders from attrs with the lookup route dead', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const s = stamp();
    const { pageId, sentinel, alpha } = await seedTwoCitationPage(page, s);

    // Cache proof — kill the lookup route BEFORE any hover. The popover must
    // come entirely from the persisted node attrs.
    await page.route('**/api/citations/lookup**', (route) => route.abort());

    const editor = await openPageEditor(page, pageId, sentinel);
    const chip1 = editor.getByLabel('Citation 1');
    await expect(chip1).toBeVisible({ timeout: 15_000 });
    await chip1.scrollIntoViewIfNeeded();

    // Hover → author + year line and the title snippet.
    await chip1.hover();
    const popover = page.locator(POPOVER);
    await expect(popover).toBeVisible({ timeout: 10_000 });
    await expect(popover).toContainText(alpha.author);
    await expect(popover).toContainText(`(${alpha.year})`);
    await expect(popover).toContainText(alpha.title);

    // Mouse-out closes…
    await page.mouse.move(0, 0);
    await expect(popover).toHaveCount(0, { timeout: 10_000 });

    // …keyboard focus reopens (a11y parity)…
    await chip1.focus();
    await expect(popover).toBeVisible({ timeout: 10_000 });
    await expect(popover).toContainText(alpha.title);

    // …and Escape closes again.
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0, { timeout: 10_000 });
  });

  test('(d) attrs round-trip a reload — popover still renders from the stored doc', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const s = stamp();
    const { pageId, sentinel, beta } = await seedTwoCitationPage(page, s);
    await openPageEditor(page, pageId, sentinel);
    await expect(page.locator('.ProseMirror').first().getByLabel('Citation 2')).toBeVisible({
      timeout: 15_000,
    });

    await page.reload();
    const editor = page.locator('.ProseMirror').first();
    await expect(editor).toContainText(sentinel, { timeout: 30_000 });

    const chip2 = editor.getByLabel('Citation 2');
    await expect(chip2).toBeVisible({ timeout: 15_000 });
    await chip2.scrollIntoViewIfNeeded();
    await chip2.hover();
    const popover = page.locator(POPOVER);
    await expect(popover).toBeVisible({ timeout: 10_000 });
    await expect(popover).toContainText(beta.author);
    await expect(popover).toContainText(`(${beta.year})`);
    await expect(popover).toContainText(beta.title);
  });

  test('(e) real /cite-doi slash flow with Cross-Ref mocked at the network layer', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const s = stamp();
    const doi = `10.1234/mock-${s}`;
    const mockedTitle = `Mocked discovery ${s}`;
    // Canned response in the lookup route's exact shape:
    // { meta: CitationMeta, formatted: { apa, mla, chicago } }.
    const lookupResponse = {
      meta: {
        source: 'doi',
        authors: [{ family: 'Mockley', given: 'Q' }],
        title: mockedTitle,
        year: 2031,
        journal: 'Journal of Mocks',
        volume: '7',
        issue: '2',
        pages: '11-22',
        doi,
        url: `https://doi.org/${doi}`,
      },
      formatted: {
        apa: `Mockley, Q. (2031). ${mockedTitle}. Journal of Mocks, 7(2), 11-22.`,
        mla: `Mockley, Q. "${mockedTitle}." Journal of Mocks, vol. 7, no. 2, 2031, pp. 11-22.`,
        chicago: `Mockley, Q. 2031. "${mockedTitle}." Journal of Mocks 7 (2): 11-22.`,
      },
    };
    await page.route('**/api/citations/lookup**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(lookupResponse),
      }),
    );

    const sentinel = `P5 cite-doi anchor ${s}`;
    const pageId = await createPageViaApi(page, `P5 cite-doi ${s}`, pmDoc(pmParagraph(sentinel)));
    const editor = await openPageEditor(page, pageId, sentinel);

    // matchesSlashQuery checks title + keywords; 'cite-doi' matches neither
    // ('Citation (DOI/PubMed lookup)'), so query the 'doi' keyword instead.
    await typeSlashQueryAtDocEnd(page, editor, '/doi');
    await expect(page.locator('.tippy-box.cairn-slash-popup')).toBeVisible({ timeout: 10_000 });
    // Grouped slash menu (#122): option accessible names concatenate
    // title + description — match by name regex (the slash-ux house pattern).
    const opt = page.getByRole('option', { name: /DOI\/PubMed lookup/i }).first();
    await opt.scrollIntoViewIfNeeded();
    await opt.click();

    // The CitationAddDialog: paste the DOI, wait for the (mocked) preview,
    // then Insert.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('DOI or PubMed ID').fill(doi);
    await expect(page.getByTestId('citation-preview')).toContainText(mockedTitle, {
      timeout: 10_000,
    });
    await page.getByRole('button', { name: 'Insert' }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // A chip renders and its popover shows the MOCKED author/year — proving
    // the meta was persisted onto the node at insert time.
    const chip = editor.getByLabel('Citation 1');
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip).toHaveText('[1]');
    await chip.scrollIntoViewIfNeeded();
    await chip.hover();
    const popover = page.locator(POPOVER);
    await expect(popover).toBeVisible({ timeout: 10_000 });
    await expect(popover).toContainText('Mockley, Q');
    await expect(popover).toContainText('(2031)');
    await expect(popover).toContainText(mockedTitle);
  });

  test('(f) published /p/<slug> renders the chip path; bibliography keeps the full entries', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const s = stamp();
    const { pageId, sentinel, alpha, beta } = await seedTwoCitationPage(page, s);

    // Lifecycle: the transition matrix only allows draft -> review ->
    // published; the public route additionally requires POST /publish.
    for (const to of ['review', 'published']) {
      const res = await page.request.post(`/api/pages/${pageId}/status`, { data: { to } });
      expect(res.ok(), `status -> ${to} failed: ${res.status()}`).toBe(true);
    }
    const pub = await page.request.post(`/api/pages/${pageId}/publish`);
    expect(pub.ok(), `publish failed: ${pub.status()}`).toBe(true);
    const { url } = (await pub.json()) as { url: string };

    await page.goto(url);
    await expect(page).toHaveURL(/\/p\//);
    await expect(page.getByText(sentinel)).toBeVisible({ timeout: 15_000 });

    // The reader body renders superscript chips, NOT the raw formatted block
    // strings (those live only in the bibliography below the body).
    const reader = page.locator('.ProseMirror').first();
    const chip1 = reader.getByLabel('Citation 1');
    const chip2 = reader.getByLabel('Citation 2');
    await expect(chip1).toBeVisible({ timeout: 15_000 });
    await expect(chip2).toBeVisible({ timeout: 15_000 });
    await expect(chip1).toHaveText('[1]');
    await expect(chip2).toHaveText('[2]');
    await expect(reader).not.toContainText(alpha.formatted);
    await expect(reader).not.toContainText(beta.formatted);

    // Bibliography order matches the chip numbers (1 → Alpha, 2 → Beta).
    const bibItems = page.locator('ol[role="doc-bibliography"] li');
    await expect(bibItems).toHaveCount(2, { timeout: 15_000 });
    await expect(bibItems.nth(0)).toContainText(alpha.formatted);
    await expect(bibItems.nth(1)).toContainText(beta.formatted);

    // The popover works on the public page too — client-side from attrs.
    await chip1.scrollIntoViewIfNeeded();
    await chip1.hover();
    const popover = page.locator(POPOVER);
    await expect(popover).toBeVisible({ timeout: 10_000 });
    await expect(popover).toContainText(alpha.author);
    await expect(popover).toContainText(`(${alpha.year})`);
    await expect(popover).toContainText(alpha.title);
  });
});

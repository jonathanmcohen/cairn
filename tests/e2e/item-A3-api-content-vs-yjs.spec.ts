// v0.9.18 Gate 3 — runtime spec for carry-forward item A3 (REST content writes
// vs. an open Yjs collab session).
//
// Behavior under guard (fixed v0.9.15): while an editor session holds the
// page's Y.Doc open in Hocuspocus, a REST `PATCH /api/pages/<id>` content
// write must NOT be clobbered by the next materialize() flush. updatePage()
// (src/lib/pages/update.ts) publishes the new content to the collab process's
// internal /replace endpoint (collab/internal-replace.ts), which applies it to
// the LIVE doc inside a transaction — broadcasting to every connected peer. So
// the open editor must show the PATCHed content WITHOUT a reload.
//
// Harness note: this needs the full collab stack. playwright.e2e.config.ts
// boots the Hocuspocus server and points the Next server's
// CAIRN_COLLAB_INTERNAL_URL at it (same wiring as docker-compose.yml).
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi, openPageEditor, pmDoc, pmParagraph } from './util';

declare global {
  interface Window {
    __a3NoReloadMarker?: boolean;
  }
}

test.describe('item A3 — API content PATCH reaches the live editor via Yjs', () => {
  test('a REST PATCH content write appears in the open editor without reload', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const before = `A3 BEFORE ${stamp}`;
    const after = `A3 AFTER ${stamp}`;
    const pageId = await createPageViaApi(
      page,
      `Item A3 yjs vs api ${stamp}`,
      pmDoc(pmParagraph(before)),
    );

    // Open the page and wait for the provider-synced editor (the BEFORE text
    // only renders after Yjs sync seeds the doc; "Live" = connected) — i.e.
    // the collab session now holds this page's Y.Doc open.
    const editor = await openPageEditor(page, pageId, before);

    // Plant an in-page marker so we can prove no reload/navigation happened.
    await page.evaluate(() => {
      window.__a3NoReloadMarker = true;
    });

    // Authenticated REST PATCH from the test (same cookie jar as the browser
    // context) — the A3 publish path: API → collab internal replace → Yjs
    // broadcast → this very editor.
    const res = await page.request.patch(`/api/pages/${pageId}`, {
      data: { content: pmDoc(pmParagraph(after)) },
    });
    expect(res.ok(), `PATCH /api/pages/${pageId} failed: ${res.status()}`).toBe(true);

    // The open editor shows the new content within a few seconds, no reload.
    await expect(editor).toContainText(after, { timeout: 15_000 });
    await expect(editor).not.toContainText(before);

    // The marker survived ⇒ the update arrived over the live Yjs connection,
    // not via any reload/navigation.
    const markerStillSet = await page.evaluate(() => window.__a3NoReloadMarker === true);
    expect(markerStillSet).toBe(true);
  });
});

// v0.10.2 P12 — degraded-collab pill beside the Live pill.
//
// Layer split (plan-sanctioned): this e2e harness boots WITH
// CAIRN_COLLAB_INTERNAL_URL set (playwright.e2e.config.ts), so the live
// stack exercises the CONFIGURED branch — the pill must be absent while the
// Live pill renders (guard — no before). The unconfigured branch (pill
// visible, role=status, i18n'd, hidden for read-only) is pinned by
// tests/components/editor/bridge-degraded-pill.test.tsx, since one e2e
// process cannot boot both env states.
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi, openPageEditor, pmDoc, pmParagraph } from './util';

test.describe('P12 — collab-bridge warning pill', () => {
  test('bridge configured: Live pill renders, degraded pill absent (guard)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const s = Date.now().toString(36);
    const sentinel = `P12 seed ${s}`;
    const pageId = await createPageViaApi(page, `P12 bridge ${s}`, pmDoc(pmParagraph(sentinel)));
    await openPageEditor(page, pageId, sentinel);
    // openPageEditor already asserted the Live pill; the degraded pill must
    // NOT render on a healthy stack — a prop default flipped to false (or a
    // server read inverted) would light it for every user.
    await expect(page.getByTestId('bridge-degraded-pill')).toHaveCount(0);
  });
});

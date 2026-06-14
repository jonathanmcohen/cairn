// v0.10.2 S14 — workspace-level collab-health indicator in the sidebar footer.
//
// Until S14 the only collab-health UI was page-scoped: the page-header "Live"
// pill inside the editor. S14 adds a matching pill to the sidebar footer that
// mirrors the active editor's collab connection state via a shared
// CollabStatusProvider (mounted in the authed app layout), and is HIDDEN when
// no page/editor is open.
//
// Coverage:
//  - Connected: open a seeded page → the page-header pill reads "Live" AND the
//    footer pill ([data-testid="footer-collab-status"]) reads "Live" with the
//    success dot — they match.
//  - Degraded: deterministically drop the live collab websocket (monkey-patch
//    window.WebSocket to a self-closing DeadWS + force-close every open
//    __cairnSocket, the same mechanism the collab-offline-banner spec uses) →
//    the footer pill flips to "Reconnecting…", proving it tracks reality rather
//    than rendering a static label.
//  - Idle: on a non-editor route (/settings) the footer pill is ABSENT
//    (status null → hidden).
//  - Labels come from messages (en assertion; es/ar keys exist — see
//    tests/i18n/item-s14-collab-status-keys.test.ts).
//
// The footer mounts twice (desktop aside + mobile drawer); the
// [data-cairn-workspace-sidebar] attribute is on the DESKTOP aside only, so
// scoping the footer pill to `.last()` of that selector disambiguates to the
// visible desktop pill, matching the other sidebar specs.
import { expect, signIn, test } from '../a11y/fixtures';

type PwPage = import('@playwright/test').Page;

const SIDEBAR = '[data-cairn-workspace-sidebar]';

/** The desktop sidebar's footer collab-status pill (disambiguated via .last()). */
function footerPill(page: PwPage) {
  return page.locator(SIDEBAR).last().getByTestId('footer-collab-status');
}

/** Wait until the editor mounts and the collab provider has connected. */
async function waitEditorLive(page: PwPage): Promise<void> {
  await page
    .locator('.ProseMirror[role="textbox"][aria-label="Page content"]')
    .first()
    .waitFor({ state: 'attached', timeout: 15_000 });
  // The page-header pill carries title="Live" when connected. Scope to the
  // page-header toolbar — S14 adds a second "Live" chip (the footer pill) so a
  // bare getByTitle('Live') would be a strict-mode 2-element match.
  await expect(page.getByTestId('page-toolbar').getByTitle('Live')).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('item S14 — sidebar-footer Live (collab health) indicator', () => {
  test('connected: footer pill mirrors the page-header "Live" pill', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto(`/pages/${seeded.pageId}`);
    await waitEditorLive(page);

    // The page-header pill reads "Live" (scoped to the toolbar — the footer
    // pill also carries title="Live").
    await expect(page.getByTestId('page-toolbar').getByTitle('Live')).toBeVisible();

    // And the footer pill matches: same label + the success dot.
    const pill = footerPill(page);
    await expect(pill).toBeVisible({ timeout: 15_000 });
    await expect(pill).toHaveText('Live');
    await expect(pill).toHaveAttribute('title', 'Live');
    // The status dot uses the shared STATUS_DOT.connected color class.
    await expect(pill.locator('span.bg-success')).toBeVisible();
  });

  test('degraded: footer pill flips to "Reconnecting…" when the live socket drops', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto(`/pages/${seeded.pageId}`);
    await waitEditorLive(page);

    const pill = footerPill(page);
    await expect(pill).toHaveText('Live');

    // Simulate a transport drop: monkey-patch WebSocket to refuse new sockets,
    // then force-close every open socket so HocuspocusProvider fires
    // onDisconnect → status 'disconnected'. The patched constructor makes the
    // backoff re-fetch's new provider fail to connect, so the degraded state is
    // deterministic (same recipe as tests/a11y/collab-offline.spec.ts).
    await page.evaluate(() => {
      const sockets = (window as unknown as { __cairnSockets?: WebSocket[] }).__cairnSockets ?? [];
      const NativeWS = window.WebSocket;
      class DeadWS extends NativeWS {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          queueMicrotask(() => this.close());
        }
      }
      (window as unknown as { WebSocket: typeof WebSocket }).WebSocket =
        DeadWS as unknown as typeof WebSocket;
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      }
    });

    // The footer pill tracks reality: it flips to the disconnected label with
    // the warning dot (proving it's not a static "Live" badge).
    await expect(pill).toHaveText('Reconnecting…', { timeout: 15_000 });
    await expect(pill.locator('span.bg-warning')).toBeVisible();
  });

  test('idle: footer pill is absent on a non-editor route (/settings)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 });

    // No editor is mounted → status is null → the footer pill renders nothing.
    // (Asserted across the whole page so a stray mobile-drawer copy would also
    // be caught.)
    await expect(page.getByTestId('footer-collab-status')).toHaveCount(0);
  });
});

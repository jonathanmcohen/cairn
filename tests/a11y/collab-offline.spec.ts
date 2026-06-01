import { DARK_INIT } from '../../playwright.config';
import { expect, signIn, test } from './fixtures';

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'dark') {
    await page.addInitScript(DARK_INIT);
  }
});

test.describe('collab offline banner (audit item I)', () => {
  test('surfaces a dismissible reconnecting banner on socket drop', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto(`/pages/${seeded.pageId}`);

    // Wait until the editor mounts and the collab provider has connected.
    await page
      .locator('.ProseMirror[role="textbox"][aria-label="Page content"]')
      .first()
      .waitFor({ state: 'attached', timeout: 15_000 });

    const banner = page.getByText('Collab offline — reconnecting…');
    await expect(banner).toBeHidden();

    // Simulate a transport drop: monkey-patch WebSocket to refuse new sockets,
    // then force-close every currently-open socket so HocuspocusProvider fires
    // onDisconnect. The patched constructor makes the backoff re-fetch's new
    // provider fail to connect, so the banner stays up deterministically.
    await page.evaluate(() => {
      const sockets = (window as unknown as { __cairnSockets?: WebSocket[] }).__cairnSockets ?? [];
      const NativeWS = window.WebSocket;
      class DeadWS extends NativeWS {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          // Immediately abort so reconnect attempts never establish.
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

    // The banner is an aria-live status region; it appears on disconnect/error.
    await expect(banner).toBeVisible({ timeout: 15_000 });

    const region = page.getByRole('status', { name: 'Collaboration status' });
    await expect(region).toHaveAttribute('aria-live', 'polite');

    // Dismiss hides it.
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner).toBeHidden();
  });
});

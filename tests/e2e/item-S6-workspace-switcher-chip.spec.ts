// v0.10.2 S6 — workspace switcher chip: real image when a file icon is set;
// accent letter when unset.
//
// Behavior under guard: a `file::<uuid>` workspace icon is resolved
// SERVER-side to an HMAC-signed `/api/files/<id>?sig=&exp=` URL
// (lib/workspaces/list.ts) and rendered as a real <img> in the switcher
// trigger AND dropdown row chips; an emoji icon still renders the emoji; no
// icon renders the letter initial on the PRIMARY accent (was bg-muted, which
// made every iconless workspace look identical).
//
// The image leg uploads a real PNG through /api/upload and asserts the
// rendered src is a signed URL that actually loads through the proxy (the F1
// lesson: signed-URL reads are gated there) — "some icon node exists" would
// false-green on the old lucide placeholder. RED on pre-fix: no <img> in the
// chip at all.
import { expect, signIn, test } from '../a11y/fixtures';

const TRIGGER = 'button[aria-label="Switch workspace"]';

// Minimal valid 1x1 transparent PNG.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('item S6 — workspace switcher chip', () => {
  test('file icon renders the uploaded image; emoji stays; no icon gets accent letter', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);

    // --- file-backed icon: upload a real PNG, point the workspace at it. ---
    const up = await page.request.post('/api/upload', {
      multipart: {
        file: { name: 's6-icon.png', mimeType: 'image/png', buffer: PNG_1X1 },
      },
    });
    expect(up.status(), 'icon PNG uploads').toBe(201);
    const { file } = (await up.json()) as { file: { id: string } };
    const fileId = file.id;

    const patchIcon = (icon: string | null) =>
      page.request.patch(`/api/workspaces/${seeded.workspaceId}/settings`, { data: { icon } });

    expect((await patchIcon(`file::${fileId}`)).ok()).toBe(true);
    await page.goto('/');
    const trigger = page.locator(TRIGGER);
    await expect(trigger).toBeVisible({ timeout: 30_000 });

    const img = trigger.locator('img');
    await expect(img, 'trigger chip renders a real <img>').toBeVisible();
    const src = await img.getAttribute('src');
    expect(src, 'src is the signed file URL').toMatch(
      new RegExp(`^/api/files/${fileId}\\?sig=[0-9a-f]+&exp=\\d+$`),
    );
    // The signed URL actually loads through the proxy — not a broken src.
    if (!src) throw new Error('unreachable: src asserted above');
    expect((await page.request.get(src)).status(), 'signed icon URL serves 200').toBe(200);

    // Dropdown row chip uses the same treatment: open it and find the row img.
    await trigger.click();
    const rowImg = page.locator(`[role="menuitem"] img[src="${src}"]`);
    await expect(rowImg, 'dropdown row chip renders the same image').toBeVisible();
    await page.keyboard.press('Escape');

    // --- emoji icon: no regression of the working branch. ---
    expect((await patchIcon('emoji::🚀')).ok()).toBe(true);
    await page.reload();
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await expect(trigger.locator('img')).toHaveCount(0);
    await expect(trigger).toContainText('🚀');

    // --- no icon: letter initial on the PRIMARY accent, not bg-muted. ---
    expect((await patchIcon(null)).ok()).toBe(true);
    await page.reload();
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await expect(trigger.locator('img')).toHaveCount(0);
    const colors = await page.evaluate((sel) => {
      const chip = document.querySelector(`${sel} span span`);
      if (!chip) return null;
      // Probe elements resolve the theme tokens to computed rgb for a
      // positive equality check (literal token values vary by theme).
      const probe = (cls: string) => {
        const el = document.createElement('div');
        el.className = cls;
        document.body.appendChild(el);
        const c = getComputedStyle(el).backgroundColor;
        el.remove();
        return c;
      };
      return {
        chip: getComputedStyle(chip).backgroundColor,
        primary: probe('bg-primary'),
        muted: probe('bg-muted'),
      };
    }, TRIGGER);
    if (!colors) throw new Error('S6: trigger chip span not found');
    expect(colors.chip, 'letter chip uses the primary accent').toBe(colors.primary);
    expect(colors.chip, 'letter chip no longer uses bg-muted').not.toBe(colors.muted);
  });
});

// v0.10.0 F1 — workspace brand: logo + primary-color override.
//
// The brand columns (workspaces.brand_logo_file_id / brand_primary_color,
// migration 0074) drive:
//   - an inline --primary/--primary-foreground/--ring override on the app
//     shell wrapper ([data-cairn-brand-scope]) — read-time contrast-clamped
//     (src/lib/workspaces/brand-color.ts) so near-white picks stay readable,
//   - the sidebar logo + the public /s/<slug> logo (HMAC-signed file URL).
//
// Determinism (persistent e2e dev DB): the seeded workspace's brand columns
// are CAPTURED up front and restored in finally — other specs depend on the
// default look. Stamped upload rows are deleted in finally too (D6 lesson).
import postgres from 'postgres';
import { hexToHslTriplet } from '@/lib/workspaces/brand-color';
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';

function stamp(): string {
  return `f1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for the e2e harness');
  const sql = postgres(url, { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

type PwPage = import('@playwright/test').Page;

type BrandSnapshot = { logoFileId: string | null; primaryColor: string | null };

/** Capture the seeded workspace's brand columns so finally can put them back. */
async function captureBrand(workspaceId: string): Promise<BrandSnapshot> {
  return withSql(async (sql) => {
    const [row] = await sql`
      select brand_logo_file_id, brand_primary_color from workspaces
      where id = ${workspaceId}::uuid
    `;
    const r = row as { brand_logo_file_id: string | null; brand_primary_color: string | null };
    return { logoFileId: r.brand_logo_file_id, primaryColor: r.brand_primary_color };
  });
}

async function restoreBrand(workspaceId: string, snap: BrandSnapshot): Promise<void> {
  await withSql(async (sql) => {
    await sql`
      update workspaces
      set brand_logo_file_id = ${snap.logoFileId}::uuid,
          brand_primary_color = ${snap.primaryColor}
      where id = ${workspaceId}::uuid
    `;
  });
}

/** Delete this spec's stamped upload rows (blobs are dev-disk noise). */
async function cleanupFiles(workspaceId: string, mark: string): Promise<void> {
  await withSql(async (sql) => {
    await sql`
      delete from files
      where workspace_id = ${workspaceId}::uuid and name like ${`%${mark}%`}
    `;
  });
}

async function patchBrand(
  page: PwPage,
  workspaceId: string,
  data: { logoFileId?: string | null; primaryColor?: string | null },
) {
  return page.request.patch(`/api/workspaces/${workspaceId}/brand`, { data });
}

/** Computed --primary channel triplet on the app-shell brand scope. */
async function computedPrimary(page: PwPage): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-cairn-brand-scope]');
    if (!el) throw new Error('brand scope missing');
    return getComputedStyle(el as HTMLElement)
      .getPropertyValue('--primary')
      .trim();
  });
}

/**
 * Mount a probe styled like the primary Button (bg-primary +
 * text-primary-foreground) inside the brand scope and compute the WCAG
 * contrast between its background and text IN PAGE.
 */
async function primaryButtonContrast(page: PwPage): Promise<number> {
  return page.evaluate(() => {
    const scope = document.querySelector('[data-cairn-brand-scope]') as HTMLElement | null;
    if (!scope) throw new Error('brand scope missing');
    const probe = document.createElement('div');
    probe.className = 'bg-primary text-primary-foreground';
    scope.appendChild(probe);
    const cs = getComputedStyle(probe);
    const parse = (v: string): [number, number, number] => {
      const m = /rgba?\((\d+),?\s*(\d+),?\s*(\d+)/.exec(v);
      if (!m) throw new Error(`unparseable color: ${v}`);
      return [Number(m[1]), Number(m[2]), Number(m[3])];
    };
    const lum = ([r, g, b]: [number, number, number]): number => {
      const chan = (v255: number) => {
        const v = v255 / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
    };
    const bg = lum(parse(cs.backgroundColor));
    const fg = lum(parse(cs.color));
    probe.remove();
    return (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
  });
}

// Smallest valid 1x1 transparent PNG (the D6 multipart idiom).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// Mid-blue: ≥4.5:1 against the pinned near-white foreground → applies unclamped.
const MID_BLUE = '#2563eb';

test.describe('item F1 — workspace brand: logo + primary color', () => {
  test('falsifiable core: PATCH a brand color → shell override; null → default returns', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const snap = await captureBrand(seeded.workspaceId);
    try {
      // Baseline BEFORE any patch (other specs leave the brand null).
      await page.goto('/');
      const baseline = await computedPrimary(page);
      expect(baseline).not.toBe(hexToHslTriplet(MID_BLUE));

      const res = await patchBrand(page, seeded.workspaceId, { primaryColor: MID_BLUE });
      expect(res.status(), await res.text().catch(() => '')).toBe(200);
      const body = (await res.json()) as {
        primaryColor: string;
        appliedPrimary: { hex: string; clamped: boolean };
      };
      expect(body.primaryColor).toBe(MID_BLUE);
      expect(body.appliedPrimary.clamped).toBe(false);

      await page.reload();
      expect(await computedPrimary(page)).toBe(hexToHslTriplet(MID_BLUE));

      // Clear → the default accent returns (d: null brand no-regression).
      expect((await patchBrand(page, seeded.workspaceId, { primaryColor: null })).status()).toBe(
        200,
      );
      await page.reload();
      expect(await computedPrimary(page)).toBe(baseline);
    } finally {
      await restoreBrand(seeded.workspaceId, snap);
    }
  });

  test('contrast clamp: a near-white pick is darkened and the rendered button is >= 4.5:1', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const snap = await captureBrand(seeded.workspaceId);
    try {
      const res = await patchBrand(page, seeded.workspaceId, { primaryColor: '#f5f5f5' });
      expect(res.status(), await res.text().catch(() => '')).toBe(200);
      const body = (await res.json()) as {
        primaryColor: string;
        appliedPrimary: { hex: string; hsl: string; clamped: boolean };
      };
      // Stored = the raw pick; applied = clamped, different from the pick.
      expect(body.primaryColor).toBe('#f5f5f5');
      expect(body.appliedPrimary.clamped).toBe(true);
      expect(body.appliedPrimary.hex).not.toBe('#f5f5f5');

      await page.goto('/');
      // The applied token differs from the raw pick…
      expect(await computedPrimary(page)).toBe(body.appliedPrimary.hsl);
      expect(await computedPrimary(page)).not.toBe(hexToHslTriplet('#f5f5f5'));
      // …and a primary-styled element really renders >= 4.5:1 (computed in-page).
      expect(await primaryButtonContrast(page)).toBeGreaterThanOrEqual(4.5);
    } finally {
      await restoreBrand(seeded.workspaceId, snap);
    }
  });

  test('logo public: uploaded logo renders on /s/<slug> for a logged-out visitor via a signed URL', async ({
    browser,
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const mark = stamp();
    const siteSlug = `f1-site-${mark}`;
    const snap = await captureBrand(seeded.workspaceId);
    let prevSite: { slug: string | null; enabled: boolean } | null = null;
    try {
      // Upload a tiny PNG (D6 multipart idiom) and PATCH it as the brand logo.
      const upRes = await page.request.post('/api/upload', {
        multipart: {
          file: { name: `${mark}-logo.png`, mimeType: 'image/png', buffer: PNG_1X1 },
        },
      });
      expect(upRes.status(), await upRes.text().catch(() => '')).toBe(201);
      const { file } = (await upRes.json()) as { file: { id: string } };

      const brandRes = await patchBrand(page, seeded.workspaceId, {
        logoFileId: file.id,
        primaryColor: MID_BLUE,
      });
      expect(brandRes.status(), await brandRes.text().catch(() => '')).toBe(200);

      // Sidebar header shows the logo for members.
      await page.goto('/');
      const sidebarLogo = page.locator('[data-cairn-brand-logo]').first();
      await expect(sidebarLogo).toBeVisible({ timeout: 15_000 });
      await expect(sidebarLogo).toHaveAttribute('src', new RegExp(`/api/files/${file.id}\\?sig=`));

      // Enable the public site at a stamped slug (D5 withSql idiom).
      prevSite = await withSql(async (sql) => {
        const [ws] = await sql`
          select public_site_slug, public_site_enabled
          from workspaces where id = ${seeded.workspaceId}::uuid
        `;
        const prev = {
          slug: (ws as { public_site_slug: string | null }).public_site_slug,
          enabled: (ws as { public_site_enabled: boolean }).public_site_enabled,
        };
        await sql`
          update workspaces
          set public_site_slug = ${siteSlug}, public_site_enabled = true
          where id = ${seeded.workspaceId}::uuid
        `;
        return prev;
      });

      // LOGGED-OUT context: the logo must come through signed (never raw).
      const anonCtx = await browser.newContext();
      try {
        const anon = await anonCtx.newPage();
        await anon.goto(`/s/${siteSlug}`);
        const logo = anon.locator('[data-cairn-brand-logo]');
        await expect(logo).toBeVisible({ timeout: 15_000 });
        const src = await logo.getAttribute('src');
        expect(src).toMatch(new RegExp(`^/api/files/${file.id}\\?sig=`));
        // The signed image request itself returns 200 anonymously.
        const imgRes = await anon.request.get(src as string);
        expect(imgRes.status()).toBe(200);
        // The page wrapper applies the brand primary publicly too.
        expect(
          await anon.evaluate(() => {
            const el = document.querySelector('[data-cairn-brand-scope]') as HTMLElement;
            return getComputedStyle(el).getPropertyValue('--primary').trim();
          }),
        ).toBe(hexToHslTriplet(MID_BLUE));
      } finally {
        await anonCtx.close();
      }
    } finally {
      await withSql(async (sql) => {
        if (prevSite) {
          await sql`
            update workspaces
            set public_site_slug = ${prevSite.slug}, public_site_enabled = ${prevSite.enabled}
            where id = ${seeded.workspaceId}::uuid
          `;
        }
      });
      // Restore brand BEFORE deleting the stamped file row (FK is SET NULL,
      // but restoring first keeps the order obviously safe).
      await restoreBrand(seeded.workspaceId, snap);
      await cleanupFiles(seeded.workspaceId, mark);
    }
  });

  test('dark mode: the accent still tracks the brand, not the default dark accent', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const snap = await captureBrand(seeded.workspaceId);
    try {
      expect(
        (await patchBrand(page, seeded.workspaceId, { primaryColor: MID_BLUE })).status(),
      ).toBe(200);
      // Flip next-themes to dark deterministically (localStorage 'theme' key —
      // the same store the Mod+Shift+L toggle writes through).
      await page.goto('/');
      await page.evaluate(() => localStorage.setItem('theme', 'dark'));
      await page.reload();
      await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 15_000 });

      // The inline brand override wins over the .dark token block.
      expect(await computedPrimary(page)).toBe(hexToHslTriplet(MID_BLUE));
      expect(await primaryButtonContrast(page)).toBeGreaterThanOrEqual(4.5);
    } finally {
      // Playwright gives each test a fresh context, but clear the key anyway.
      await page.evaluate(() => localStorage.removeItem('theme')).catch(() => {});
      await restoreBrand(seeded.workspaceId, snap);
    }
  });

  test('roles: editor PATCH 403; editor GET 200 and sees the override', async ({
    browser,
    page,
    seeded,
  }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for the e2e harness');
    await signIn(page, seeded);
    const snap = await captureBrand(seeded.workspaceId);
    try {
      // Admin (seeded owner) sets the brand.
      expect(
        (await patchBrand(page, seeded.workspaceId, { primaryColor: MID_BLUE })).status(),
      ).toBe(200);

      const editor = await seedSecondUser(databaseUrl, { workspaceId: seeded.workspaceId });
      const { context, page: editorPage } = await signInSecondUser(browser, editor);
      try {
        // Editor cannot write…
        const patchRes = await editorPage.request.patch(
          `/api/workspaces/${seeded.workspaceId}/brand`,
          { data: { primaryColor: '#e11d48' } },
        );
        expect(patchRes.status()).toBe(403);

        // …but reads the brand (member GET 200) and the shell shows it.
        const getRes = await editorPage.request.get(`/api/workspaces/${seeded.workspaceId}/brand`);
        expect(getRes.status()).toBe(200);
        expect(((await getRes.json()) as { primaryColor: string }).primaryColor).toBe(MID_BLUE);

        await editorPage.goto('/');
        expect(await computedPrimary(editorPage)).toBe(hexToHslTriplet(MID_BLUE));
      } finally {
        await context.close();
      }
    } finally {
      await restoreBrand(seeded.workspaceId, snap);
    }
  });
});

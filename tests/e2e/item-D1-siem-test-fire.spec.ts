// v0.10.0 D1 — SIEM forwarder "Send test" button (/settings/admin/siem →
// POST /api/admin/siem/[id]/test).
//
// The strongest-possible success proof: the spec hosts a tiny Node http sink
// on 127.0.0.1 and points an http-kind forwarder at it. The SEND happens
// server-side (the booted standalone server), which can reach the spec's
// listener on localhost — so the spec asserts the UI success state AND that
// the sink received exactly one synthetic `siem.test_event` envelope.
//
// All forwarders are created with `enabled: false`: the background dispatcher
// (and the 60s retry cron) only fans out to enabled forwarders, so the
// workspace.settings_changed audit row written by the create itself never
// produces deliveries for these rows — which keeps the "test fires never land
// in siem_delivery_log" assertion deterministic. The test route intentionally
// ignores `enabled`. The e2e dev DB is persistent across runs, so every
// forwarder is stamped uniquely and deleted in a finally.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import postgres from 'postgres';
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';

function stamp(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createForwarder(
  page: Page,
  body: {
    kind: string;
    name: string;
    endpoint: string;
    options?: Record<string, unknown>;
    enabled?: boolean;
  },
): Promise<string> {
  const res = await page.request.post('/api/admin/siem', { data: body });
  expect(res.status(), await res.text()).toBe(201);
  const { forwarder } = (await res.json()) as { forwarder: { id: string } };
  return forwarder.id;
}

async function deleteForwarder(page: Page, id: string): Promise<void> {
  const res = await page.request.delete(`/api/admin/siem/${id}`);
  expect(res.ok(), `cleanup DELETE /api/admin/siem/${id} failed: ${res.status()}`).toBe(true);
}

/**
 * Count siem_delivery_log rows for ONE forwarder, straight from the DB the
 * booted app points at (no admin API exposes the delivery log — the SIEM
 * routes are list/create/update/delete/test only). Scoping by forwarder_id
 * makes the assertion immune to stale enabled forwarders earlier runs may
 * have left in the persistent dev DB.
 */
async function deliveryLogCount(forwarderId: string): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for the e2e harness');
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql`
      select count(*)::int as n from siem_delivery_log where forwarder_id = ${forwarderId}
    `;
    return (rows[0] as { n: number }).n;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function forwarderRow(page: Page, name: string) {
  return page.getByTestId('siem-forwarder-row').filter({ hasText: name });
}

test.describe('item D1 — SIEM forwarder Send test', () => {
  test('success path: real send to a local sink → success UI, exactly one siem.test_event, no delivery-log row', async ({
    page,
    seeded,
  }) => {
    const name = `d1-success-${stamp()}`;
    const received: Array<{ method: string | undefined; body: string }> = [];
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8');
      });
      req.on('end', () => {
        received.push({ method: req.method, body: raw });
        res.statusCode = 200;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    let forwarderId: string | null = null;
    try {
      await signIn(page, seeded);
      forwarderId = await createForwarder(page, {
        kind: 'http',
        name,
        endpoint: `http://127.0.0.1:${port}/hook`,
        enabled: false,
      });
      expect(await deliveryLogCount(forwarderId)).toBe(0);

      await page.goto('/settings/admin/siem');
      const row = forwarderRow(page, name);
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByTestId('siem-send-test').click();
      await expect(row.getByTestId('siem-test-success')).toBeVisible({ timeout: 15_000 });

      // The booted server performed ONE real POST carrying the synthetic
      // envelope — the route builds it with action `siem.test_event` and
      // metadata.synthetic=true.
      expect(received).toHaveLength(1);
      const first = received[0];
      if (!first) throw new Error('sink received no request');
      expect(first.method).toBe('POST');
      const envelope = JSON.parse(first.body) as {
        action: string;
        metadata: { synthetic?: boolean; source?: string };
      };
      expect(envelope.action).toBe('siem.test_event');
      expect(envelope.metadata.synthetic).toBe(true);

      // The synthetic test event must NOT land in siem_delivery_log.
      expect(await deliveryLogCount(forwarderId)).toBe(0);
    } finally {
      if (forwarderId) await deleteForwarder(page, forwarderId);
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  test('failure path: unreachable endpoint → failure UI with the remote error collapsed until expanded', async ({
    page,
    seeded,
  }) => {
    const name = `d1-fail-${stamp()}`;
    let forwarderId: string | null = null;
    try {
      await signIn(page, seeded);
      forwarderId = await createForwarder(page, {
        kind: 'http',
        // Discard port → connection refused, fails fast; the short timeout is
        // a belt-and-braces clamp so a black-holed port can't stall the spec.
        endpoint: 'http://127.0.0.1:9/hook',
        name,
        options: { timeoutMs: 1_500 },
        enabled: false,
      });

      await page.goto('/settings/admin/siem');
      const row = forwarderRow(page, name);
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByTestId('siem-send-test').click();

      await expect(row.getByTestId('siem-test-failure')).toBeVisible({ timeout: 15_000 });
      // The remote error string comes back VERBATIM from the target — it must
      // be present in the DOM but COLLAPSED (inside a closed <details>) until
      // the admin explicitly expands it.
      const remoteError = row.getByTestId('siem-test-remote-error');
      await expect(row.getByTestId('siem-test-remote-details')).toBeVisible();
      await expect(remoteError).toBeHidden();
      await row.getByTestId('siem-test-remote-details').locator('summary').click();
      await expect(remoteError).toBeVisible();
      await expect(remoteError).not.toBeEmpty();

      // A failed test fire must not write a delivery-log row either.
      expect(await deliveryLogCount(forwarderId)).toBe(0);
    } finally {
      if (forwarderId) await deleteForwarder(page, forwarderId);
    }
  });

  test('s3 kind: Send test is disabled with an explanatory tooltip, and a direct POST answers 400', async ({
    page,
    seeded,
  }) => {
    const name = `d1-s3-${stamp()}`;
    let forwarderId: string | null = null;
    try {
      await signIn(page, seeded);
      forwarderId = await createForwarder(page, {
        kind: 's3',
        name,
        endpoint: 's3://cairn-e2e-bucket',
        enabled: false,
      });

      await page.goto('/settings/admin/siem');
      const row = forwarderRow(page, name);
      await expect(row).toBeVisible({ timeout: 15_000 });
      const button = row.getByTestId('siem-send-test');
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute(
        'title',
        'Test sends are not available for this forwarder kind.',
      );

      // Defensive contract check through the real proxy: the route 400s with
      // the no-sender message (the UI handles this body shape if a future
      // kind ships without a sender before the disable-list catches up).
      const res = await page.request.post(`/api/admin/siem/${forwarderId}/test`);
      expect(res.status()).toBe(400);
      const body = (await res.json()) as { ok?: boolean; error?: string };
      expect(body.ok).toBe(false);
      expect(String(body.error)).toContain('no sender wired');
    } finally {
      if (forwarderId) await deleteForwarder(page, forwarderId);
    }
  });

  test('editor role: direct POST to the test route answers 403', async ({
    browser,
    page,
    seeded,
  }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for the e2e harness');
    const name = `d1-editor-${stamp()}`;
    let forwarderId: string | null = null;
    try {
      await signIn(page, seeded);
      forwarderId = await createForwarder(page, {
        kind: 'http',
        name,
        endpoint: 'http://127.0.0.1:9/hook',
        enabled: false,
      });

      // seedSecondUser defaults to role 'editor' — below the admin gate. The
      // settings page itself is RSC-gated by requireRole('admin'); the route
      // contract is what an attacker would hit, so assert it directly.
      const second = await seedSecondUser(databaseUrl, { workspaceId: seeded.workspaceId });
      const { context, page: editorPage } = await signInSecondUser(browser, second);
      try {
        const res = await editorPage.request.post(`/api/admin/siem/${forwarderId}/test`);
        expect(res.status()).toBe(403);
      } finally {
        await context.close();
      }
    } finally {
      if (forwarderId) await deleteForwarder(page, forwarderId);
    }
  });
});

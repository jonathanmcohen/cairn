# v0.9.9 Plan H — Security UX

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Close the six G6-security-UX findings that ship correct backends but leak operator internals, mislead users with destructive-styled informational copy, or surface raw decision errors. Make the SSO admin surface visually consistent, render active sessions with a human-readable device label and a real client IP (not the Docker bridge address), reframe the encryption self-service card as informational rather than an error, scope passkey-not-configured detail to admins, make the operations-doc reference a clickable link, and turn the approval `409` into actionable, auto-dismissing copy. No new tables; one tiny `users`-adjacent change is NOT needed — this group is presentation + one dependency (`ua-parser-js`) + one IP-resolution hardening. Migration **0062** is reserved by G6 (#195 notification types) in the scope doc and is **out of scope for Plan H** — Plan H adds **no migration**.

**Architecture:** All six findings are workspace-scoped server/client React components under `src/app/(app)/settings/**` and `src/components/security/**` plus one shared client component (`approval-panel.tsx`). Roles come from `requireRole`/`getAuthContext` (`src/lib/auth/require-role.ts`); `ctx.role` is a `MemberRole` (`owner > admin > editor > viewer`) and `hasMinRole(role, 'admin')` gates admin-tier detail. New user-facing strings go to `messages/{en,es,ar}.json` and render via `useT()` (`src/lib/i18n/provider`). The trusted-proxy / real-client-IP logic reuses the existing `clientIp(headers, { trustProxy })` helper and the `TRUST_PROXY` env flag in `src/lib/security/rate-limit.ts` rather than re-deriving X-Forwarded-For parsing in `auth/config.ts`. Tests are jsdom React Testing Library component tests (mirroring `tests/components/security/sessions-card.test.tsx`) plus pure-unit tests for the UA-label and IP-resolution helpers; the approval route gets an integration test in the existing `tests/api/pages-approval.test.ts` style.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript 6 strict · Drizzle + Postgres · Biome v2 (0-errors) · Vitest 4 + Testcontainers · TipTap 3 · Tailwind v4 + shadcn/ui · i18n en/es/ar via `useT()`. Single PR onto `patches/v0.9.9`. GitHub-hosted runners only.

---

## H1 — SSO "Add" buttons consistent variant (#12 / #191)

**Cause:** `settings/admin/sso/page.tsx:85-90` renders "Add OIDC" as the default (filled) variant and "Add SAML" as `variant="outline"`, implying a primary/secondary hierarchy between two equally-valid identity-provider types. Both should share one variant.

**Decision (consistent variant):** make both `variant="outline"` `size="sm"` — there is no preferred IdP type, and `outline` reads as a neutral "add another" action consistent with the `Edit` ghost buttons in the list below. Add `title`/`aria-label` parity.

**Files:**
- Create `tests/components/admin/sso/sso-add-buttons.test.tsx`
- Modify `src/app/(app)/settings/admin/sso/page.tsx`

Note: `page.tsx` is an async server component (DB calls). To keep the test pure, extract the two Add buttons into a tiny client/presentational component `IdpAddButtons` co-located in the same file's directory.

- [ ] Write failing test `tests/components/admin/sso/sso-add-buttons.test.tsx`: render `<IdpAddButtons />`, assert both links exist and **share the same Button variant class**. Concretely assert neither button carries the default/filled variant — both resolve to the outline token:
  ```tsx
  // @vitest-environment jsdom
  import { cleanup, render, screen } from '@testing-library/react';
  import { afterEach, describe, expect, it } from 'vitest';
  import { IdpAddButtons } from '@/components/admin/sso/idp-add-buttons';

  afterEach(cleanup);

  describe('IdpAddButtons (#191)', () => {
    it('renders both Add links with the same outline variant', () => {
      render(<IdpAddButtons />);
      const oidc = screen.getByRole('link', { name: 'Add OIDC' });
      const saml = screen.getByRole('link', { name: 'Add SAML' });
      // shadcn outline variant => border + bg-background; default => bg-primary
      expect(oidc.className).toBe(saml.className);
      expect(oidc.className).not.toContain('bg-primary');
      expect(oidc.className).toContain('border');
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/admin/sso/sso-add-buttons.test.tsx` (fails: module `@/components/admin/sso/idp-add-buttons` does not exist).
- [ ] Create `src/components/admin/sso/idp-add-buttons.tsx` (minimal impl):
  ```tsx
  import type { Route } from 'next';
  import Link from 'next/link';
  import { Button } from '@/components/ui/button';

  export function IdpAddButtons() {
    return (
      <div className="flex gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href={'/settings/admin/sso/oidc/new' as Route}>Add OIDC</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={'/settings/admin/sso/saml/new' as Route}>Add SAML</Link>
        </Button>
      </div>
    );
  }
  ```
- [ ] Modify `src/app/(app)/settings/admin/sso/page.tsx`: replace the inline `<div className="flex gap-2">…</div>` (lines 84-91) with `<IdpAddButtons />` and add `import { IdpAddButtons } from '@/components/admin/sso/idp-add-buttons';`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/admin/sso/sso-add-buttons.test.tsx` (green).
- [ ] Commit: `fix(sso): give both Add-IdP buttons the same outline variant (#191)`

---

## H2 — Active sessions: friendly UA label + real client IP behind trusted proxy (#13 / #192)

**Cause (two halves):**
1. `sessions-card.tsx:84` renders the raw `s.userAgent` string (e.g. `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36…`) verbatim — unreadable.
2. `auth/config.ts:36` (`readSignInClient`) takes `x-forwarded-for.split(',')[0]` **unconditionally**. Behind the docker-compose reverse proxy with no `TRUST_PROXY` discipline, on a direct container hit the captured value is the Docker bridge gateway (`172.x.x.x`) instead of the real client. The fix is to resolve the IP through the existing trusted-proxy helper and store `null` (hidden in UI) when not trusted, rather than persisting a misleading internal address.

**Dependency:** add `ua-parser-js` (MIT, no native build, already-allowed pure JS) for the device label. Pin a current version.

**Files:**
- Modify `package.json` (add `ua-parser-js` + `@types/ua-parser-js` dev dep)
- Create `src/lib/security/user-agent-label.ts`
- Create `tests/lib/security/user-agent-label.test.ts`
- Modify `src/lib/auth/config.ts` (`readSignInClient`, line 31-41)
- Create `tests/lib/auth/sign-in-client-ip.test.ts`
- Modify `src/components/security/sessions-card.tsx`
- Modify `tests/components/security/sessions-card.test.tsx`

### H2a — UA → friendly label helper

- [ ] Write failing test `tests/lib/security/user-agent-label.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { friendlyUserAgent } from '@/lib/security/user-agent-label';

  describe('friendlyUserAgent (#192)', () => {
    it('summarizes a desktop Chrome UA', () => {
      const ua =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
      expect(friendlyUserAgent(ua)).toBe('Chrome on macOS');
    });
    it('summarizes mobile Safari on iOS', () => {
      const ua =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
      expect(friendlyUserAgent(ua)).toBe('Safari on iOS');
    });
    it('returns null for empty/unparseable input', () => {
      expect(friendlyUserAgent(null)).toBeNull();
      expect(friendlyUserAgent('')).toBeNull();
      expect(friendlyUserAgent('curl/8.4.0')).toBe('curl');
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/security/user-agent-label.test.ts` (fails: missing module + missing dep).
- [ ] Add dependency: `source ~/.zshenv && pnpm add ua-parser-js && pnpm add -D @types/ua-parser-js`. (Pure JS, no `allowBuilds:` entry needed.)
- [ ] Create `src/lib/security/user-agent-label.ts` (minimal impl):
  ```ts
  import { UAParser } from 'ua-parser-js';

  /**
   * #192 — collapse a raw User-Agent string into a short "Browser on OS" label
   * for the active-sessions list. Returns null when there is nothing useful to
   * show (so the UI falls back to its "Unknown device" string). Non-browser
   * agents (CLI tools) return just the product name.
   */
  export function friendlyUserAgent(ua: string | null | undefined): string | null {
    if (!ua) return null;
    const { browser, os } = UAParser(ua);
    const b = browser.name?.trim();
    const o = os.name?.trim();
    if (b && o) return `${b} on ${o}`;
    if (b) return b;
    if (o) return o;
    // CLI tools like "curl/8.4.0" — UAParser leaves browser empty; take the product.
    const product = ua.split('/')[0]?.trim();
    return product || null;
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/security/user-agent-label.test.ts` (green).
- [ ] Commit: `feat(security): add friendlyUserAgent label helper via ua-parser-js (#192)`

### H2b — real client IP behind trusted proxy on sign-in

- [ ] Write failing test `tests/lib/auth/sign-in-client-ip.test.ts` (pure helper extracted from `readSignInClient`):
  ```ts
  import { describe, expect, it } from 'vitest';
  import { resolveSignInIp } from '@/lib/auth/sign-in-client';

  describe('resolveSignInIp (#192)', () => {
    it('returns the leftmost XFF entry when proxy is trusted', () => {
      const h = new Headers({ 'x-forwarded-for': '203.0.113.9, 172.18.0.1' });
      expect(resolveSignInIp(h, { trustProxy: true })).toBe('203.0.113.9');
    });
    it('returns null (hides Docker bridge IP) when proxy is NOT trusted', () => {
      const h = new Headers({ 'x-forwarded-for': '172.18.0.1' });
      expect(resolveSignInIp(h, { trustProxy: false })).toBeNull();
    });
    it('falls back to x-real-ip when trusted and no XFF', () => {
      const h = new Headers({ 'x-real-ip': '198.51.100.7' });
      expect(resolveSignInIp(h, { trustProxy: true })).toBe('198.51.100.7');
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/auth/sign-in-client-ip.test.ts` (fails: missing module).
- [ ] Create `src/lib/auth/sign-in-client.ts` (minimal impl; reuses the rate-limit `clientIp` contract but returns `null` when untrusted so the session row stores nothing misleading):
  ```ts
  import { clientIp } from '@/lib/security/rate-limit';

  /**
   * #192 — resolve the real client IP for an `auth_sessions` row. When the
   * deployment is NOT behind a trusted proxy (TRUST_PROXY!=='true') we refuse to
   * persist a forwarded value — it would be the Docker bridge gateway, not the
   * user. clientIp() returns the literal 'unknown' sentinel in that case; we
   * map it to null so the sessions UI hides the field entirely.
   */
  export function resolveSignInIp(
    headers: Headers,
    opts: { trustProxy: boolean },
  ): string | null {
    if (!opts.trustProxy) return null;
    const ip = clientIp(headers, { trustProxy: true });
    return ip === 'unknown' ? null : ip;
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/auth/sign-in-client-ip.test.ts` (green).
- [ ] Modify `src/lib/auth/config.ts` `readSignInClient` (lines 31-41) to delegate the IP resolution and gate on `TRUST_PROXY` instead of the unconditional `split(',')[0]`:
  ```ts
  import { resolveSignInIp } from './sign-in-client';
  // ...
  async function readSignInClient(): Promise<{ ua: string | null; ip: string | null }> {
    try {
      const { headers } = await import('next/headers');
      const h = await headers();
      const ua = h.get('user-agent');
      const ip = resolveSignInIp(h, { trustProxy: process.env.TRUST_PROXY === 'true' });
      return { ua, ip };
    } catch {
      return { ua: null, ip: null };
    }
  }
  ```
- [ ] Run to pass (no regressions in auth config tests): `source ~/.zshenv && pnpm vitest run tests/lib/auth`.
- [ ] Commit: `fix(security): only persist sign-in IP behind a trusted proxy (#192)`

### H2c — render friendly label in the sessions card

- [ ] Add a failing assertion to `tests/components/security/sessions-card.test.tsx` (new `it`): given `userAgent` is the raw desktop-Chrome string above, the rendered text is `Chrome on macOS`, and the raw `Mozilla/5.0…` substring is **not** in the document:
  ```tsx
  it('renders a friendly device label, not the raw UA (#192)', async () => {
    fetchMock.mockResolvedValueOnce(
      sessionsResponse([
        {
          id: 's1',
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ip: '203.0.113.9',
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          current: true,
        },
      ]),
    );
    render(wrap(<SessionsCard />));
    expect(await screen.findByText('Chrome on macOS')).toBeTruthy();
    expect(screen.queryByText(/Mozilla\/5\.0/)).toBeNull();
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/security/sessions-card.test.tsx` (fails: raw UA still rendered).
- [ ] Modify `src/components/security/sessions-card.tsx`: import the helper and replace the device-name expression at line 84:
  ```tsx
  import { friendlyUserAgent } from '@/lib/security/user-agent-label';
  // ...
  <span className="truncate font-medium text-sm">
    {friendlyUserAgent(s.userAgent) ?? t('security.sessions.unknownDevice')}
  </span>
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/security/sessions-card.test.tsx` (green; existing tests still pass — they used already-friendly fixtures like `'Chrome on macOS'`, which `friendlyUserAgent` returns unchanged since UAParser will not match and the product fallback yields `'Chrome on macOS'`; if any existing fixture regresses, update it to a real UA string in the same commit).
- [ ] Commit: `fix(security): show friendly device label in active sessions (#192)`

---

## H3 — Encryption self-service card: informational, not error (#14 / #193)

**Cause:** `e2e-enroll-card.tsx` paints multiple self-service states in `text-destructive` red — `disabledBuild` (line 80), `needs-recovery` (line 96), and the runtime `error` (line 106). The disabled/unconfigured state is **not an error**: a homelab operator who simply hasn't turned E2EE on should see calm, informational copy with a docs link, matching the admin-side `EncryptionDisabledNotice` pattern (`src/components/admin/encryption-disabled-notice.tsx`, which uses `bg-muted/40` + muted body + `e2ee.docsLink`). Reuse that exact component for the `enabled === false` branch. Genuine errors (passphrase mismatch, runtime failure) **stay** destructive — those are real.

**Files:**
- Modify `src/components/security/e2e-enroll-card.tsx`
- Create `tests/components/security/e2e-enroll-card.test.tsx`

No new strings: reuse existing `e2ee.disabledTitle` / `e2ee.disabledBody` / `e2ee.docsLink` (all present in `messages/{en,es,ar}.json`) via the shared `EncryptionDisabledNotice`.

- [ ] Write failing test `tests/components/security/e2e-enroll-card.test.tsx`:
  ```tsx
  // @vitest-environment jsdom
  import { cleanup, render, screen } from '@testing-library/react';
  import type { ReactNode } from 'react';
  import { afterEach, describe, expect, it } from 'vitest';
  import { E2EEnrollCard } from '@/components/security/e2e-enroll-card';
  import { getMessages } from '@/lib/i18n/messages';
  import { I18nProvider } from '@/lib/i18n/provider';

  function wrap(node: ReactNode) {
    return (
      <I18nProvider locale="en" messages={getMessages('en')}>
        {node}
      </I18nProvider>
    );
  }
  afterEach(cleanup);

  describe('E2EEnrollCard disabled state (#193)', () => {
    it('renders the informational notice (not a destructive error) when disabled', () => {
      const { container } = render(wrap(<E2EEnrollCard enabled={false} />));
      // informational title + docs link from the shared notice
      expect(screen.getByText('End-to-end encryption is turned off in this build.')).toBeTruthy();
      expect(screen.getByText('Read the encryption admin guide')).toBeTruthy();
      // no destructive red text in the disabled branch
      expect(container.querySelector('.text-destructive')).toBeNull();
      expect(container.querySelector('.bg-muted\\/40')).not.toBeNull();
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/security/e2e-enroll-card.test.tsx` (fails: current disabled branch uses `text-destructive` + `e2e.enroll.disabledBuild`).
- [ ] Modify `src/components/security/e2e-enroll-card.tsx`: import the shared notice and replace the `if (!enabled)` block (lines 76-83):
  ```tsx
  import { EncryptionDisabledNotice } from '@/components/admin/encryption-disabled-notice';
  // ...
  if (!enabled) {
    return (
      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="font-semibold text-lg">{t('e2e.enroll.title')}</h2>
        <EncryptionDisabledNotice />
      </section>
    );
  }
  ```
  Leave the `needs-recovery` and runtime `error` branches destructive — they are real error states. (#193 is specifically the disabled/unconfigured-not-an-error case.)
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/security/e2e-enroll-card.test.tsx` (green).
- [ ] Commit: `fix(security): show E2EE-disabled card as informational, not an error (#193)`

---

## H4 — Passkeys page: admin-tier detail vs end-user message (#89 / #267)

**Cause:** `settings/security/passkeys/page.tsx:35-40` shows the literal env-var names `CAIRN_RP_ID` + `CAIRN_RP_ORIGIN` and a deployment-config instruction to **every** user when WebAuthn is unconfigured. A non-admin end-user can't act on that and shouldn't see operator internals; an admin should get the actionable detail. Gate on role.

The page already calls `auth()` for the user; we need the workspace role. Use `getAuthContext()` (cached, returns `{ userId, workspaceId, role }`) and `hasMinRole(role, 'admin')` from `@/lib/auth/require-role`.

**Files:**
- Modify `src/app/(app)/settings/security/passkeys/page.tsx`
- Create `src/components/security/passkeys-not-configured.tsx` (presentational, role-aware, testable without DB)
- Create `tests/components/security/passkeys-not-configured.test.tsx`
- Add i18n keys to `messages/{en,es,ar}.json`

New strings (`passkeys.notConfigured.*`):

```json
// messages/en.json  (add under "passkeys")
"passkeys": {
  "notConfigured": {
    "title": "Passkeys aren't available",
    "userBody": "This Cairn instance doesn't have passkeys enabled yet. Ask your workspace administrator to turn them on.",
    "adminBody": "WebAuthn isn't configured. Set CAIRN_RP_ID and CAIRN_RP_ORIGIN in the deployment environment, then redeploy, to enable passkey enrollment.",
    "adminDocs": "See the operations guide"
  }
}
```
```json
// messages/es.json
"passkeys": {
  "notConfigured": {
    "title": "Las llaves de acceso no están disponibles",
    "userBody": "Esta instancia de Cairn aún no tiene las llaves de acceso habilitadas. Pide a la persona administradora de tu espacio de trabajo que las active.",
    "adminBody": "WebAuthn no está configurado. Define CAIRN_RP_ID y CAIRN_RP_ORIGIN en el entorno de despliegue y vuelve a desplegar para habilitar el registro de llaves de acceso.",
    "adminDocs": "Consulta la guía de operaciones"
  }
}
```
```json
// messages/ar.json
"passkeys": {
  "notConfigured": {
    "title": "مفاتيح المرور غير متاحة",
    "userBody": "لم يتم تفعيل مفاتيح المرور في نسخة Cairn هذه بعد. اطلب من مسؤول مساحة العمل تفعيلها.",
    "adminBody": "لم يتم إعداد WebAuthn. اضبط CAIRN_RP_ID وCAIRN_RP_ORIGIN في بيئة النشر ثم أعد النشر لتفعيل تسجيل مفاتيح المرور.",
    "adminDocs": "راجع دليل التشغيل"
  }
}
```

- [ ] Write failing test `tests/components/security/passkeys-not-configured.test.tsx`:
  ```tsx
  // @vitest-environment jsdom
  import { cleanup, render, screen } from '@testing-library/react';
  import type { ReactNode } from 'react';
  import { afterEach, describe, expect, it } from 'vitest';
  import { PasskeysNotConfigured } from '@/components/security/passkeys-not-configured';
  import { getMessages } from '@/lib/i18n/messages';
  import { I18nProvider } from '@/lib/i18n/provider';

  function wrap(node: ReactNode) {
    return (
      <I18nProvider locale="en" messages={getMessages('en')}>
        {node}
      </I18nProvider>
    );
  }
  afterEach(cleanup);

  describe('PasskeysNotConfigured (#267)', () => {
    it('hides env-var names from non-admins', () => {
      render(wrap(<PasskeysNotConfigured isAdmin={false} />));
      expect(screen.getByText(/workspace administrator/)).toBeTruthy();
      expect(screen.queryByText(/CAIRN_RP_ID/)).toBeNull();
    });
    it('shows the actionable env-var detail to admins', () => {
      render(wrap(<PasskeysNotConfigured isAdmin />));
      expect(screen.getByText(/CAIRN_RP_ID and CAIRN_RP_ORIGIN/)).toBeTruthy();
      expect(screen.getByRole('link', { name: 'See the operations guide' })).toBeTruthy();
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/security/passkeys-not-configured.test.tsx` (fails: missing module + missing keys).
- [ ] Add the three i18n blocks above to `messages/en.json`, `messages/es.json`, `messages/ar.json` (merge into the existing `passkeys` object if present, else create it).
- [ ] Create `src/components/security/passkeys-not-configured.tsx`:
  ```tsx
  'use client';

  import { useT } from '@/lib/i18n/provider';

  const OPERATIONS_DOCS_URL =
    'https://github.com/jonathanmcohen/cairn/blob/main/docs/operations.md';

  export function PasskeysNotConfigured({ isAdmin }: { isAdmin: boolean }) {
    const t = useT();
    return (
      <div className="rounded-md border border-border bg-muted/40 p-4 text-sm">
        <p className="font-medium">{t('passkeys.notConfigured.title')}</p>
        <p className="mt-2 text-muted-foreground">
          {isAdmin ? t('passkeys.notConfigured.adminBody') : t('passkeys.notConfigured.userBody')}
        </p>
        {isAdmin && (
          <a
            className="mt-2 inline-block underline underline-offset-4"
            href={OPERATIONS_DOCS_URL}
          >
            {t('passkeys.notConfigured.adminDocs')}
          </a>
        )}
      </div>
    );
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/security/passkeys-not-configured.test.tsx` (green).
- [ ] Modify `src/app/(app)/settings/security/passkeys/page.tsx`: import `getAuthContext` + `hasMinRole` and the new component; replace the inline `<div className="rounded border p-4 …">…</div>` (lines 35-40) with the role-aware component:
  ```tsx
  import { getAuthContext, hasMinRole } from '@/lib/auth/require-role';
  import { PasskeysNotConfigured } from '@/components/security/passkeys-not-configured';
  // ...
  if (!e.CAIRN_RP_ID || !e.CAIRN_RP_ORIGIN) {
    const ctx = await getAuthContext();
    const isAdmin = hasMinRole(ctx?.role ?? null, 'admin');
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <SettingsBreadcrumb
          section={{ label: 'Security', href: '/settings/security' as Route }}
          page="Passkeys"
        />
        <h1 className="font-semibold text-2xl">Passkeys</h1>
        <PasskeysNotConfigured isAdmin={isAdmin} />
      </main>
    );
  }
  ```
  (If `hasMinRole`'s signature rejects `null`, coerce: `hasMinRole(ctx?.role ?? 'viewer', 'admin')` — verify against `src/lib/auth/roles.ts` and use whichever the existing callers use.)
- [ ] Run to pass + typecheck the page: `source ~/.zshenv && pnpm vitest run tests/components/security && pnpm typecheck`.
- [ ] Commit: `fix(security): scope passkey-not-configured detail to admins (#267)`

---

## H5 — `docs/operations.md` clickable link (#90 / #268)

**Cause:** `settings/security/passkeys/page.tsx:39` (and the generic copy elsewhere) referenced `docs/operations.md` as bare `<code>` text — not clickable. H4 already replaced the passkeys instance of this with `PasskeysNotConfigured` (which links to the GitHub `operations.md`). H5 covers the **remaining** plain-text reference so the affordance is consistent: standardize on the same GitHub `operations.md` URL via a shared constant and an `OperationsDocLink` component, and use it wherever operations.md is mentioned in UI copy.

Audit target: the only other in-UI plain reference is the connectors panel which already links via `CONNECTOR_DOCS_URL` (`src/app/(app)/settings/developer/connectors/connectors-panel.tsx:11`) — that one is fine. To avoid drift, hoist the URL to one place and point both the new passkeys link (H4) and any future copy at it.

**Files:**
- Create `src/lib/docs-links.ts`
- Create `tests/lib/docs-links.test.ts`
- Modify `src/components/security/passkeys-not-configured.tsx` (use the shared constant)

- [ ] Write failing test `tests/lib/docs-links.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { OPERATIONS_DOCS_URL } from '@/lib/docs-links';

  describe('docs links (#268)', () => {
    it('points operations.md at the GitHub blob URL (clickable, not a bare path)', () => {
      expect(OPERATIONS_DOCS_URL).toBe(
        'https://github.com/jonathanmcohen/cairn/blob/main/docs/operations.md',
      );
      expect(OPERATIONS_DOCS_URL.startsWith('https://')).toBe(true);
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/docs-links.test.ts` (fails: missing module).
- [ ] Create `src/lib/docs-links.ts`:
  ```ts
  /**
   * #268 — single source of truth for in-app documentation deep-links so UI
   * copy links out instead of printing bare repo paths like `docs/operations.md`.
   */
  const REPO_DOCS_BASE = 'https://github.com/jonathanmcohen/cairn/blob/main/docs';

  export const OPERATIONS_DOCS_URL = `${REPO_DOCS_BASE}/operations.md`;
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/docs-links.test.ts` (green).
- [ ] Modify `src/components/security/passkeys-not-configured.tsx` to import and use the shared constant instead of the local literal:
  ```tsx
  import { OPERATIONS_DOCS_URL } from '@/lib/docs-links';
  // delete the local `const OPERATIONS_DOCS_URL = ...` line; href={OPERATIONS_DOCS_URL} unchanged
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/docs-links.test.ts tests/components/security/passkeys-not-configured.test.tsx`.
- [ ] Commit: `fix(docs): link operations.md instead of printing a bare path (#268)`

---

## H6 — Approval error: actionable copy (map 409) + auto-dismiss 5s (#96/100 = #270 / #272)

**Cause (two halves):**
1. `approval-panel.tsx:73` sets `setError(`Decision failed (${res.status})`)` — the raw `409` reaches the user with no explanation. The `409` from `decide` route is currently emitted by `NoVersionSnapshotError` and by `HttpError(409)` thrown in `src/lib/pages/approval.ts` (self-approval / stale-state / already-resolved conflicts). The UI must map `409` to friendly, actionable copy (e.g. "You can't approve your own review" / "This review was already resolved"). To disambiguate the two `409` causes, key off the response body's `error` field when available, falling back to a generic conflict message.
2. `#272`: the error string never auto-clears. Add a 5-second auto-dismiss timer (and clear on the next submit, which already happens via `setError(null)` at the top of `submit`).

**Files:**
- Modify `src/components/pages/approval-panel.tsx`
- Modify `tests/components/pages/approval-panel.test.tsx`
- Add i18n keys to `messages/{en,es,ar}.json`

This component is currently string-literal English (`Decision failed (…)`, `Approval`, `Approve`, etc.) and does **not** use `useT()`. The minimal, in-scope change is to introduce `useT()` for the new error strings only (not a full re-translation of the panel, which is out of scope). New strings (`approval.error.*`):

```json
// messages/en.json  (add under "approval")
"approval": {
  "error": {
    "selfApprove": "You can't approve your own review.",
    "resolved": "This review was already resolved. Refresh to see the latest decision.",
    "conflict": "This review couldn't be decided — its state changed. Refresh and try again.",
    "generic": "Couldn't record your decision. Please try again."
  }
}
```
```json
// messages/es.json
"approval": {
  "error": {
    "selfApprove": "No puedes aprobar tu propia revisión.",
    "resolved": "Esta revisión ya se resolvió. Actualiza para ver la última decisión.",
    "conflict": "No se pudo decidir esta revisión porque su estado cambió. Actualiza e inténtalo de nuevo.",
    "generic": "No se pudo registrar tu decisión. Inténtalo de nuevo."
  }
}
```
```json
// messages/ar.json
"approval": {
  "error": {
    "selfApprove": "لا يمكنك الموافقة على مراجعتك الخاصة.",
    "resolved": "تمت معالجة هذه المراجعة بالفعل. حدّث الصفحة لعرض آخر قرار.",
    "conflict": "تعذّر اتخاذ قرار بشأن هذه المراجعة لأن حالتها تغيّرت. حدّث الصفحة وحاول مرة أخرى.",
    "generic": "تعذّر تسجيل قرارك. يرجى المحاولة مرة أخرى."
  }
}
```

Note: H6 depends on the `decide` route returning a stable, machine-readable discriminator for the self-approval case. As part of this task, confirm `src/lib/pages/approval.ts` throws `HttpError(409, '<message>')` for self-approval and already-resolved; the route forwards `err.message` as the `error` body field (`decide/route.ts:48`). The UI maps on a substring of that message. If the lib does not yet distinguish self-approval, add a guard in `approval.ts` (`if (input.approverUserId === <submitterUserId>) throw new HttpError(409, 'self-approval')`) with its own unit test in `tests/lib/pages/approval-lifecycle.test.ts` before wiring the UI — keep that change in the same commit and zero-deferral.

- [ ] Add failing assertions to `tests/components/pages/approval-panel.test.tsx`:
  - On a `409` decide response whose body is `{ error: 'self-approval' }`, the rendered alert reads `You can't approve your own review.` and **not** `Decision failed (409)`.
  - The alert auto-dismisses: after advancing fake timers by 5000 ms it is gone.
  ```tsx
  it('maps a self-approval 409 to actionable copy and auto-dismisses (#270/#272)', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ history: [] }) }); // initial load
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'self-approval' }),
    });
    render(wrap(<ApprovalPanel pageId="p1" canDecide inReview />));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("You can't approve your own review.");
    expect(screen.queryByText(/Decision failed/)).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    vi.useRealTimers();
  });
  ```
  (Wrap `ApprovalPanel` in the same `I18nProvider` helper used in the other component tests; add the `wrap`/`I18nProvider` import to this file if not present.)
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/pages/approval-panel.test.tsx` (fails: raw status string, no auto-dismiss, no i18n keys).
- [ ] Add the three `approval.error` i18n blocks to `messages/{en,es,ar}.json`.
- [ ] Modify `src/components/pages/approval-panel.tsx`:
  - Add `import { useT } from '@/lib/i18n/provider';` and `const t = useT();` in the component body.
  - Replace the error branch in `submit` (lines 72-75) with a mapper + 5s auto-dismiss:
  ```tsx
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setError(messageForDecisionError(res.status, body.error, t));
    return;
  }
  ```
  - Add the mapper above the component (pure, so it can be unit-tested if desired):
  ```tsx
  function messageForDecisionError(
    status: number,
    code: string | undefined,
    t: (k: string) => string,
  ): string {
    if (status === 409) {
      if (code?.includes('self-approval')) return t('approval.error.selfApprove');
      if (code?.includes('resolved') || code?.includes('already')) return t('approval.error.resolved');
      return t('approval.error.conflict');
    }
    return t('approval.error.generic');
  }
  ```
  - Add the auto-dismiss effect (clears whenever `error` becomes truthy):
  ```tsx
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(id);
  }, [error]);
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/pages/approval-panel.test.tsx` (green).
- [ ] Commit: `fix(approval): map 409 to actionable copy and auto-dismiss after 5s (#270, #272)`

---

## H-Gate — Plan H group gate (HOLD for GO before merge)

Run on a GitHub-hosted runner; zero-deferral; all must pass with the stated thresholds.

- [ ] **Lint (0 errors):** `source ~/.zshenv && pnpm lint` — Biome reports 0 errors (accept its import-ordering / `import type` auto-fixes; re-run after `biome check --write` if needed).
- [ ] **Typecheck:** `source ~/.zshenv && pnpm typecheck` — `tsc --noEmit` clean (covers the new `ua-parser-js` types, the role-coercion in H4, and the `t` callback typing in H6).
- [ ] **i18n none-new:** run the repo's i18n completeness check so en/es/ar are in sync and **no key is missing/orphaned** for the new `passkeys.notConfigured.*` and `approval.error.*` namespaces (`source ~/.zshenv && pnpm lint` includes the Biome i18n rule from v0.9.0 P31; if a dedicated script exists, e.g. `pnpm i18n:check`, run it too). Confirm the three catalogs have identical key sets.
- [ ] **FULL test suite:** `source ~/.zshenv && pnpm vitest run` — the entire suite passes (Testcontainers Postgres required; isolation stays ON per CLAUDE.md). Not just the Plan-H files — the full run.
- [ ] **Build:** `source ~/.zshenv && pnpm build` — `next build` + entrypoint tsc succeed (UI/route changes touched server components in `settings/admin/sso` and `settings/security/passkeys`).
- [ ] **e2e UI-acceptance gate (route-reachability + per-feature deployed-image check):** against the built/deployed image, Playwright route-reachability smoke confirms each touched route returns 200 and renders without console errors:
  - `/settings/admin/sso` — both Add buttons present, same variant (H1).
  - `/settings/security` — active sessions list renders a friendly device label, no raw `Mozilla/5.0…`, IP hidden when `TRUST_PROXY` unset (H2); E2EE card shows the muted informational notice when E2EE disabled, no `.text-destructive` in that card (H3).
  - `/settings/security/passkeys` — with `CAIRN_RP_ID` unset: as a non-admin no `CAIRN_RP_ID` text leaks; as an admin the env-var detail + "See the operations guide" link is present and the link `href` is the GitHub `operations.md` URL (H4/H5).
  - A page in `in_review` where the current user is the submitter: clicking **Approve** shows "You can't approve your own review." (not `Decision failed (409)`) and the alert disappears within ~5s (H6).
- [ ] **Single PR:** open one PR with all H1-H6 commits onto `patches/v0.9.9`. PR body lists closed issues: `Closes #191, #192, #193, #267, #268, #270, #272`. **HOLD — do not merge; await user GO.**

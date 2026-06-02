# Cairn v0.9.8 — G1: Admin & SSO IA (audit items A, B)

**For agentic workers:** REQUIRED SUB-SKILL — `superpowers:test-driven-development`. Every task below is written as a strict red→green TDD loop. Do NOT skip the run-to-fail step; do NOT write implementation before its failing test exists. One logical change per commit.

**Goal:** Resolve audit items A (Admin tab dead-end) and B (SSO 404 / wrong URL) by (1) making the Admin sidebar parent navigate to a real page, (2) relocating the SSO console under the settings hub at `/settings/admin/sso/*` with redirects from every old `/admin/sso*` path, (3) building a federated-search admin page at `/settings/admin/federated`, and (4) building a dedicated user-management page at `/settings/admin/users` that replaces the cross-link to `/settings/workspace/members`. All four surfaces are admin-role-gated and fully i18n'd (en/es/ar).

**Architecture:** Next.js 16 App Router (React 19, TS6 strict), Drizzle + Postgres, Biome v2, Vitest 4 + Testcontainers, Tailwind v4 + shadcn/ui. Settings nav model lives in `src/components/settings/sidebar.tsx` (a `useMemo` section tree, role-gated at line 205). SSO pages are RSCs under `src/app/(app)/admin/sso/*` that gate via `requireRole('admin')` and render client forms from `src/components/admin/sso/*`. Federated search reuses `canFederate()` (`src/app/(app)/search/can-federate.ts`) and the `peer_instances` table (`src/db/schema/peer-instances.ts`); G1 adds the missing peer-CRUD lib + API + admin page. User management reuses `listWorkspaceMembers`/`setMemberRole`/`removeMember` (`src/lib/workspaces/admin-members.ts`), the existing `MembersTable`/`InvitesManager` client components, and the existing member API routes (`/api/workspaces/[id]/members/[userId]`, `/api/invites`). API routes under `/api/admin/sso/*`, `/api/sso/*`, `/api/scim/*` are NOT touched. **No migration in G1** (`peer_instances` already exists from v0.9.0 P30).

**Tech Stack:** TypeScript 6 strict, React 19 RSC + client components, Drizzle ORM, Zod v4, shadcn/ui (Button/Select), `useT()` i18n with flat dotted keys in `messages/{en,es,ar}.json`, Vitest 4 (+ Testcontainers Postgres) for unit/integration, Playwright (`tests/a11y/*.spec.ts`, dir `./tests/a11y`) for e2e. Shell commands MUST be prefixed `source ~/.zshenv && `.

> **i18n key format note (read once):** `messages/*.json` are FLAT objects with dotted string keys (e.g. `"settings.nav.admin.federated": "Federated search"`), NOT nested objects. `useT()` resolves a key via `Object.hasOwn(messages, key)` and returns the key itself on a miss. Add new keys to all three of `en.json`, `es.json`, `ar.json`. `pnpm i18n:check` runs `tsx scripts/i18n-audit.ts` (flags hardcoded JSX strings); route every new user-facing string through `t(...)` or it will trip the audit.

> **Redirect strategy note (read once):** old `/admin/sso*` deep links are redirected via `next.config.mjs`'s `async redirects()` (App Router native, supports `:path*` wildcards, returns HTTP 308 permanent). This handles `/admin/sso`, `/admin/sso/oidc/new`, `/admin/sso/oidc/:id/edit`, `/admin/sso/saml/new`, `/admin/sso/saml/:id/edit` with a single wildcard rule. We do NOT touch `/api/admin/sso/*`.

---

## Task 1 — Admin sidebar parent navigates to a real page

**Problem:** The `admin` section in the sidebar is a `<Link href="/settings/admin">`. `/settings/admin/page.tsx` `redirect()`s to `/settings/admin/audit`, so a click *does* eventually land, but it relies on a server redirect round-trip and the active-state logic. The locked decision (Section 1.3 / Section 3 G1) is: clicking the Admin parent must navigate directly to `/settings/admin/audit`. We point the parent `href` straight at the real leaf so navigation is one hop and the active/aria-current logic stays correct, while keeping the role-gate at line 205.

### Files
- **Modify** `src/components/settings/sidebar.tsx` — `admin` Section `href` (line 140) → `/settings/admin/audit`.
- **Create** `tests/unit/settings-admin-nav.test.tsx` — assert the rendered Admin link points at `/settings/admin/audit` and is hidden for non-admins.

### Steps

1. **Write the failing test.** Create `tests/unit/settings-admin-nav.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsSidebar } from '@/components/settings/sidebar';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';

function renderSidebar(isAdmin: boolean) {
  return render(
    <I18nProvider locale="en" messages={en as Record<string, string>}>
      <SettingsSidebar isAdmin={isAdmin} />
    </I18nProvider>,
  );
}

describe('SettingsSidebar admin parent nav', () => {
  it('Admin parent link points at the real audit leaf, not the bare section', () => {
    renderSidebar(true);
    const adminLink = screen.getByRole('link', { name: en['settings.nav.admin'] });
    expect(adminLink).toHaveAttribute('href', '/settings/admin/audit');
  });

  it('hides the Admin section entirely for non-admins', () => {
    renderSidebar(false);
    expect(screen.queryByRole('link', { name: en['settings.nav.admin'] })).toBeNull();
  });
});
```

2. **Run to fail.** Expected: the first assertion fails because the current href is `/settings/admin`.

```sh
source ~/.zshenv && pnpm vitest run tests/unit/settings-admin-nav.test.tsx
```

Expected output (abridged): `AssertionError: expected '/settings/admin' to equal '/settings/admin/audit'` — 1 failed, 1 passed.

3. **Minimal implementation.** In `src/components/settings/sidebar.tsx`, change the `admin` section `href` so the parent click lands on the real leaf. The active-state logic (`pathname === s.href || pathname.startsWith(\`${s.href}/\`)`) still highlights the section on every `/settings/admin/*` route because the audit child shares the prefix; to keep the section open on ALL admin sub-routes we also broaden the active check for this one section. Replace the admin Section object (lines 137–142):

```tsx
      {
        id: 'admin',
        label: t('settings.nav.admin'),
        // Parent click navigates straight to the first real leaf. The bare
        // /settings/admin route still 308-redirects here server-side, but the
        // nav no longer depends on that round-trip (audit item A).
        href: '/settings/admin/audit' as Route,
        children: adminChildren,
      },
```

Because the section is now keyed on the `audit` leaf, the existing `active`/child-render branch already keeps the children expanded on `/settings/admin/audit*`. To keep the whole Admin group expanded on the OTHER admin sub-routes (`/settings/admin/siem`, `/settings/admin/users`, etc.), broaden the per-section active test. Replace the `active` line (line 234):

```tsx
        const active =
          s.id === 'admin'
            ? pathname.startsWith('/settings/admin')
            : pathname === s.href || pathname.startsWith(`${s.href}/`);
```

4. **Run to pass.**

```sh
source ~/.zshenv && pnpm vitest run tests/unit/settings-admin-nav.test.tsx
```

Expected output: `Test Files  1 passed (1)` · `Tests  2 passed (2)`.

5. **Commit.**

```sh
git add src/components/settings/sidebar.tsx tests/unit/settings-admin-nav.test.tsx && git commit -m "fix(settings): Admin sidebar parent navigates to /settings/admin/audit"
```

---

## Task 2 — Relocate SSO console under the settings hub + redirect old paths

**Problem:** Audit item B: users guessed `/settings/workspace/sso` (404). The full SSO console exists but lives OUTSIDE the hub at `/admin/sso/*`. Locked decision (Section 1.8): move it to `/settings/admin/sso/*` and 308-redirect every old `/admin/sso*` path. The shared client forms in `src/components/admin/sso/*` are NOT moved. API routes are untouched.

### Files
- **Create** `src/app/(app)/settings/admin/sso/page.tsx` — moved from `src/app/(app)/admin/sso/page.tsx`, with internal links repointed to `/settings/admin/sso/*`.
- **Create** `src/app/(app)/settings/admin/sso/oidc/new/page.tsx` — moved from old path (unchanged body).
- **Create** `src/app/(app)/settings/admin/sso/oidc/[idpId]/edit/page.tsx` — moved from old path (unchanged body).
- **Create** `src/app/(app)/settings/admin/sso/saml/new/page.tsx` — moved from old path (unchanged body).
- **Create** `src/app/(app)/settings/admin/sso/saml/[idpId]/edit/page.tsx` — moved from old path (unchanged body).
- **Delete** the five old files under `src/app/(app)/admin/sso/`.
- **Modify** `next.config.mjs` — add `async redirects()` for `/admin/sso/:path*` and `/admin/sso`.
- **Modify** `src/components/settings/sidebar.tsx` — repoint `admin-sso` child href (line 72) to `/settings/admin/sso`.
- **Create** `tests/unit/next-redirects.test.ts` — assert the redirect config maps every old SSO path to the new one.

### Steps

1. **Write the failing test.** Create `tests/unit/next-redirects.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.mjs';

describe('SSO route relocation redirects', () => {
  it('redirects every legacy /admin/sso* path to /settings/admin/sso*', async () => {
    expect(typeof nextConfig.redirects).toBe('function');
    const rules = await nextConfig.redirects!();
    const sso = rules.find((r) => r.source === '/admin/sso/:path*');
    expect(sso).toBeDefined();
    expect(sso?.destination).toBe('/settings/admin/sso/:path*');
    expect(sso?.permanent).toBe(true);

    const ssoRoot = rules.find((r) => r.source === '/admin/sso');
    expect(ssoRoot).toBeDefined();
    expect(ssoRoot?.destination).toBe('/settings/admin/sso');
    expect(ssoRoot?.permanent).toBe(true);
  });
});
```

2. **Run to fail.** Expected: `nextConfig.redirects` is `undefined` (no redirects function yet).

```sh
source ~/.zshenv && pnpm vitest run tests/unit/next-redirects.test.ts
```

Expected output (abridged): `AssertionError: expected 'undefined' to be 'function'` — 1 failed.

3. **Implementation — add the redirects.** In `next.config.mjs`, add an `async redirects()` to the `nextConfig` object, immediately after the `async headers()` block (after line 69, inside the object literal):

```js
  async redirects() {
    // Audit item B: the SSO console moved into the settings hub
    // (/admin/sso* → /settings/admin/sso*). Keep old bookmarks/deep links
    // working with a permanent (308) redirect. The wildcard rule covers
    // oidc/new, oidc/:id/edit, saml/new, saml/:id/edit; the bare rule covers
    // the index. API routes under /api/admin/sso/* are NOT redirected.
    return [
      {
        source: '/admin/sso/:path*',
        destination: '/settings/admin/sso/:path*',
        permanent: true,
      },
      {
        source: '/admin/sso',
        destination: '/settings/admin/sso',
        permanent: true,
      },
    ];
  },
```

4. **Implementation — move the five pages.** Create the new files. The four form pages are byte-for-byte copies (their bodies reference only the shared form components in `src/components/admin/sso/*`, which do not move).

   `src/app/(app)/settings/admin/sso/oidc/new/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { OidcForm } from '@/components/admin/sso/oidc-form';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

export default async function NewOidcConfigPage() {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/');
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">New OIDC provider</h1>
      <OidcForm />
    </div>
  );
}
```

   `src/app/(app)/settings/admin/sso/saml/new/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { SamlForm } from '@/components/admin/sso/saml-form';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

export default async function NewSamlConfigPage() {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/');
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">New SAML provider</h1>
      <SamlForm />
    </div>
  );
}
```

   `src/app/(app)/settings/admin/sso/oidc/[idpId]/edit/page.tsx` (unchanged body — copy from the old file):

```tsx
import { and, eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { OidcForm } from '@/components/admin/sso/oidc-form';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

export default async function EditOidcConfigPage(props: { params: Promise<{ idpId: string }> }) {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/');
  const { idpId } = await props.params;
  const [row] = await getDb()
    .select()
    .from(schema.idpConfigurations)
    .where(
      and(
        eq(schema.idpConfigurations.id, idpId),
        eq(schema.idpConfigurations.workspaceId, ctx.workspaceId),
        eq(schema.idpConfigurations.type, 'oidc'),
      ),
    )
    .limit(1);
  if (!row) notFound();
  const meta = (row.metadata ?? {}) as Record<string, string>;
  const attr = (row.attributeMap ?? {}) as Record<string, string>;
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">Edit OIDC provider</h1>
      <OidcForm
        idpId={idpId}
        initial={{
          name: row.name,
          issuer: meta.issuer ?? '',
          clientId: meta.clientId ?? '',
          clientSecret: '',
          emailClaim: attr.email ?? 'email',
          nameClaim: attr.name ?? 'name',
          enabled: row.enabled,
        }}
      />
    </div>
  );
}
```

   `src/app/(app)/settings/admin/sso/saml/[idpId]/edit/page.tsx` (unchanged body — copy from the old file):

```tsx
import { and, eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { SamlForm } from '@/components/admin/sso/saml-form';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

export default async function EditSamlConfigPage(props: { params: Promise<{ idpId: string }> }) {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/');
  const { idpId } = await props.params;
  const [row] = await getDb()
    .select()
    .from(schema.idpConfigurations)
    .where(
      and(
        eq(schema.idpConfigurations.id, idpId),
        eq(schema.idpConfigurations.workspaceId, ctx.workspaceId),
        eq(schema.idpConfigurations.type, 'saml'),
      ),
    )
    .limit(1);
  if (!row) notFound();
  const meta = (row.metadata ?? {}) as {
    idp?: { entityId?: string; ssoUrl?: string; x509Cert?: string };
  };
  const attr = (row.attributeMap ?? {}) as Record<string, string>;
  const origin = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">Edit SAML provider</h1>
      <SamlForm
        idpId={idpId}
        metadataUrl={`${origin.replace(/\/$/, '')}/api/sso/saml/metadata/${idpId}`}
        initial={{
          name: row.name,
          idpEntityId: meta.idp?.entityId ?? '',
          ssoUrl: meta.idp?.ssoUrl ?? '',
          x509Cert: '',
          emailAttr: attr.email ?? 'email',
          nameAttr: attr.name ?? 'name',
          enabled: row.enabled,
        }}
      />
    </div>
  );
}
```

   `src/app/(app)/settings/admin/sso/page.tsx` — moved index, with the two `Link href` "Add OIDC"/"Add SAML" and the per-row Edit href repointed to `/settings/admin/sso/*`:

```tsx
import { desc, eq } from 'drizzle-orm';
import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ScimTokenList, type ScimTokenRow } from '@/components/admin/sso/scim-token-list';
import { Button } from '@/components/ui/button';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

const SSO_AUDIT_ACTIONS = new Set<string>([
  'sso.idp.created',
  'sso.idp.updated',
  'sso.idp.deleted',
  'sso.scim.token.minted',
  'sso.scim.token.revoked',
]);

export default async function AdminSsoPage() {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/');
  const db = getDb();

  const idps = await db
    .select({
      id: schema.idpConfigurations.id,
      type: schema.idpConfigurations.type,
      name: schema.idpConfigurations.name,
      enabled: schema.idpConfigurations.enabled,
      createdAt: schema.idpConfigurations.createdAt,
    })
    .from(schema.idpConfigurations)
    .where(eq(schema.idpConfigurations.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.idpConfigurations.createdAt));

  const tokens: ScimTokenRow[] = (
    await db
      .select({
        id: schema.scimTokens.id,
        name: schema.scimTokens.name,
        scopes: schema.scimTokens.scopes,
        createdAt: schema.scimTokens.createdAt,
        lastUsedAt: schema.scimTokens.lastUsedAt,
      })
      .from(schema.scimTokens)
      .where(eq(schema.scimTokens.workspaceId, ctx.workspaceId))
      .orderBy(desc(schema.scimTokens.createdAt))
  ).map((r) => ({
    id: r.id,
    name: r.name,
    scopes: r.scopes ?? [],
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  }));

  const recentAudit = await db
    .select({
      id: schema.auditLog.id,
      action: schema.auditLog.action,
      createdAt: schema.auditLog.createdAt,
      metadata: schema.auditLog.metadata,
    })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(50);

  const ssoAudit = recentAudit.filter((r) => SSO_AUDIT_ACTIONS.has(r.action));

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <header>
        <h1 className="text-3xl font-semibold">Single sign-on</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure OIDC, SAML, and SCIM provisioning for this workspace.
        </p>
      </header>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Identity providers</h2>
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link href={'/settings/admin/sso/oidc/new' as Route}>Add OIDC</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={'/settings/admin/sso/saml/new' as Route}>Add SAML</Link>
            </Button>
          </div>
        </div>
        {idps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No identity providers configured.</p>
        ) : (
          <ul className="space-y-2">
            {idps.map((idp) => (
              <li key={idp.id} className="flex items-center gap-3 rounded border bg-card p-3">
                <div className="flex-1">
                  <div className="font-medium">{idp.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {idp.type.toUpperCase()} · {idp.enabled ? 'Enabled' : 'Disabled'} · Created{' '}
                    {new Date(idp.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <Button asChild size="sm" variant="ghost">
                  <Link
                    href={
                      (idp.type === 'oidc'
                        ? `/settings/admin/sso/oidc/${idp.id}/edit`
                        : `/settings/admin/sso/saml/${idp.id}/edit`) as Route
                    }
                  >
                    Edit
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">SCIM 2.0 provisioning tokens</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Bearer tokens for the SCIM 2.0 endpoint at <code>/api/scim/v2/Users</code> and{' '}
          <code>/Groups</code>. Filters: <code>userName eq</code> and{' '}
          <code>meta.lastModified gt</code> only.
        </p>
        <ScimTokenList initial={tokens} />
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Recent SSO audit entries</h2>
        {ssoAudit.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent SSO audit events.</p>
        ) : (
          <ul className="space-y-1">
            {ssoAudit.map((r) => (
              <li key={r.id} className="text-sm">
                <span className="text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </span>{' '}
                · <code className="text-xs">{r.action}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

5. **Delete the old pages.**

```sh
source ~/.zshenv && rm -r "src/app/(app)/admin/sso"
```

6. **Repoint the sidebar SSO child.** In `src/components/settings/sidebar.tsx`, change the `admin-sso` child (line 72) so it now points INTO the hub. Also update the stale comment block above it (lines 28–31 / 71) since SSO no longer "lives outside" the hub:

```tsx
      { id: 'admin-sso', label: t('settings.nav.admin.sso'), href: '/settings/admin/sso' as Route },
```

7. **Run to pass (redirects test).**

```sh
source ~/.zshenv && pnpm vitest run tests/unit/next-redirects.test.ts
```

Expected output: `Test Files  1 passed (1)` · `Tests  1 passed (1)`.

8. **Verify the new route tree builds (type-level).**

```sh
source ~/.zshenv && pnpm typecheck
```

Expected: exits 0 (the new `as Route` hrefs are valid; `typedRoutes` picks up the new files).

9. **Commit.**

```sh
git add next.config.mjs "src/app/(app)/settings/admin/sso" src/components/settings/sidebar.tsx tests/unit/next-redirects.test.ts && git add -A "src/app/(app)/admin" && git commit -m "feat(settings): relocate SSO console to /settings/admin/sso with legacy redirects"
```

---

## Task 3 — Federated-search peer-management lib + API + tests

**Problem:** Section 3 G1 requires a federated-search admin page that manages cross-instance peers, reusing `canFederate()`. The `peer_instances` table and the fan-out/inbound search routes already exist (v0.9.0 P30), but there is NO CRUD surface for peers. This task builds the pure, db-injected lib + the admin API route + tests. (The page UI is Task 4's i18n + Task 5's component wiring — split so each commit is one logical change.)

### Files
- **Create** `src/lib/search/peer-admin.ts` — `listPeers`, `createPeer`, `setPeerEnabled`, `deletePeer` (pure, db-injected; audit on mutate).
- **Create** `src/app/api/admin/federated/peers/route.ts` — `GET` (list) + `POST` (create), `requireRole('admin')`.
- **Create** `src/app/api/admin/federated/peers/[peerId]/route.ts` — `PATCH` (enable/disable) + `DELETE`, `requireRole('admin')`.
- **Create** `tests/integration/peer-admin.test.ts` — Testcontainers round-trip of list/create/toggle/delete + workspace scoping.

### Steps

1. **Write the failing test.** Create `tests/integration/peer-admin.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { createPeer, deletePeer, listPeers, setPeerEnabled } from '@/lib/search/peer-admin';
import { getTestDb, startPostgres, stopPostgres, truncateAll } from '../helpers/db';

let wsA: string;
let wsB: string;
let actor: string;

beforeAll(startPostgres);
afterAll(stopPostgres);

beforeEach(async () => {
  await truncateAll();
  const db = getTestDb();
  const [u] = await db
    .insert(schema.users)
    .values({ email: 'admin@example.com', name: 'Admin', passwordHash: 'x' })
    .returning();
  actor = u.id;
  const [a] = await db.insert(schema.workspaces).values({ name: 'A', slug: 'a' }).returning();
  const [b] = await db.insert(schema.workspaces).values({ name: 'B', slug: 'b' }).returning();
  wsA = a.id;
  wsB = b.id;
});

describe('peer-admin lib', () => {
  it('creates a peer (disabled by default) and lists it scoped to the workspace', async () => {
    const db = getTestDb();
    const peer = await createPeer(db, {
      workspaceId: wsA,
      actorUserId: actor,
      name: 'partner',
      baseUrl: 'https://partner.example.com',
      sharedSecret: 'super-secret-value',
    });
    expect(peer.enabled).toBe(false);

    const listed = await listPeers(db, wsA);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe('partner');
    // The shared secret MUST NOT be returned to the admin UI.
    expect(JSON.stringify(listed)).not.toContain('super-secret-value');

    // Workspace scoping: wsB sees nothing.
    expect(await listPeers(db, wsB)).toHaveLength(0);
  });

  it('toggles enabled and deletes only within the owning workspace', async () => {
    const db = getTestDb();
    const peer = await createPeer(db, {
      workspaceId: wsA,
      actorUserId: actor,
      name: 'partner',
      baseUrl: 'https://partner.example.com',
      sharedSecret: 's3cr3t',
    });

    await setPeerEnabled(db, { workspaceId: wsA, actorUserId: actor, peerId: peer.id, enabled: true });
    expect((await listPeers(db, wsA))[0]?.enabled).toBe(true);

    // A cross-workspace delete attempt is a no-op (scoping guard).
    const crossDeleted = await deletePeer(db, {
      workspaceId: wsB,
      actorUserId: actor,
      peerId: peer.id,
    });
    expect(crossDeleted).toBe(false);
    expect(await listPeers(db, wsA)).toHaveLength(1);

    const deleted = await deletePeer(db, { workspaceId: wsA, actorUserId: actor, peerId: peer.id });
    expect(deleted).toBe(true);
    expect(await listPeers(db, wsA)).toHaveLength(0);
  });
});
```

2. **Run to fail.** Expected: module `@/lib/search/peer-admin` does not exist.

```sh
source ~/.zshenv && pnpm vitest run tests/integration/peer-admin.test.ts
```

Expected output (abridged): `Error: Failed to resolve import "@/lib/search/peer-admin"` — suite fails to collect.

3. **Implementation — the lib.** Create `src/lib/search/peer-admin.ts`:

```ts
import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

type Db = PostgresJsDatabase<typeof schema>;

/** Peer row safe to return to the admin UI — never includes the shared secret. */
export type PeerSummary = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
};

export async function listPeers(db: Db, workspaceId: string): Promise<PeerSummary[]> {
  const rows = await db
    .select({
      id: schema.peerInstances.id,
      name: schema.peerInstances.name,
      baseUrl: schema.peerInstances.baseUrl,
      enabled: schema.peerInstances.enabled,
      lastSyncedAt: schema.peerInstances.lastSyncedAt,
      lastError: schema.peerInstances.lastError,
      createdAt: schema.peerInstances.createdAt,
    })
    .from(schema.peerInstances)
    .where(eq(schema.peerInstances.workspaceId, workspaceId))
    .orderBy(desc(schema.peerInstances.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    baseUrl: r.baseUrl,
    enabled: r.enabled,
    lastSyncedAt: r.lastSyncedAt ? r.lastSyncedAt.toISOString() : null,
    lastError: r.lastError,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function createPeer(
  db: Db,
  input: {
    workspaceId: string;
    actorUserId: string;
    name: string;
    baseUrl: string;
    sharedSecret: string;
  },
): Promise<PeerSummary> {
  const [row] = await db
    .insert(schema.peerInstances)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      baseUrl: input.baseUrl,
      // MVP: peer-fanout recomputes the HMAC from the raw secret, so it is
      // stored as-is (see peer-instances.ts header). Treat like any secret.
      sharedSecretHash: input.sharedSecret,
      enabled: false,
    })
    .returning();
  await recordAudit(db, {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: 'federation.peer_created',
    targetType: 'peer_instance',
    targetId: row.id,
    metadata: { name: input.name, baseUrl: input.baseUrl },
  });
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    enabled: row.enabled,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function setPeerEnabled(
  db: Db,
  input: { workspaceId: string; actorUserId: string; peerId: string; enabled: boolean },
): Promise<boolean> {
  const updated = await db
    .update(schema.peerInstances)
    .set({ enabled: input.enabled })
    .where(
      and(
        eq(schema.peerInstances.id, input.peerId),
        eq(schema.peerInstances.workspaceId, input.workspaceId),
      ),
    )
    .returning({ id: schema.peerInstances.id });
  if (updated.length === 0) return false;
  await recordAudit(db, {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: input.enabled ? 'federation.peer_enabled' : 'federation.peer_disabled',
    targetType: 'peer_instance',
    targetId: input.peerId,
    metadata: {},
  });
  return true;
}

export async function deletePeer(
  db: Db,
  input: { workspaceId: string; actorUserId: string; peerId: string },
): Promise<boolean> {
  const deleted = await db
    .delete(schema.peerInstances)
    .where(
      and(
        eq(schema.peerInstances.id, input.peerId),
        eq(schema.peerInstances.workspaceId, input.workspaceId),
      ),
    )
    .returning({ id: schema.peerInstances.id });
  if (deleted.length === 0) return false;
  await recordAudit(db, {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: 'federation.peer_deleted',
    targetType: 'peer_instance',
    targetId: input.peerId,
    metadata: {},
  });
  return true;
}
```

4. **Run to pass (lib).**

```sh
source ~/.zshenv && pnpm vitest run tests/integration/peer-admin.test.ts
```

Expected output: `Test Files  1 passed (1)` · `Tests  2 passed (2)`.

5. **Implementation — the API routes.** Create `src/app/api/admin/federated/peers/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { createPeer, listPeers } from '@/lib/search/peer-admin';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(128),
  baseUrl: z.url(),
  sharedSecret: z.string().min(16).max(512),
});

export async function GET(): Promise<Response> {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ peers: await listPeers(getDb(), ctx.workspaceId) });
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const peer = await createPeer(getDb(), {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    name: parsed.data.name,
    baseUrl: parsed.data.baseUrl,
    sharedSecret: parsed.data.sharedSecret,
  });
  return NextResponse.json({ peer }, { status: 201 });
}
```

   Create `src/app/api/admin/federated/peers/[peerId]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { deletePeer, setPeerEnabled } from '@/lib/search/peer-admin';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({ enabled: z.boolean() });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ peerId: string }> },
): Promise<Response> {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { peerId } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const ok = await setPeerEnabled(getDb(), {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    peerId,
    enabled: parsed.data.enabled,
  });
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ peerId: string }> },
): Promise<Response> {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { peerId } = await params;
  const ok = await deletePeer(getDb(), {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    peerId,
  });
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

6. **Typecheck the routes.**

```sh
source ~/.zshenv && pnpm typecheck
```

Expected: exits 0.

7. **Commit.**

```sh
git add src/lib/search/peer-admin.ts "src/app/api/admin/federated/peers" tests/integration/peer-admin.test.ts && git commit -m "feat(federation): peer-admin lib + CRUD API for federated-search peers"
```

---

## Task 4 — i18n keys for federated-search + user-management pages

**Problem:** Both new pages (Tasks 5 + 6) need user-facing copy in en/es/ar. Add the keys first so the page components in the next tasks can reference `t(...)` and pass `pnpm i18n:check`.

### Files
- **Modify** `messages/en.json` — add the federated + users keys.
- **Modify** `messages/es.json` — same keys, Spanish.
- **Modify** `messages/ar.json` — same keys, Arabic.

### Steps

1. **Write the failing test.** Create `tests/unit/g1-i18n-keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json';
import en from '../../messages/en.json';
import es from '../../messages/es.json';

const REQUIRED = [
  'settings.nav.admin.federated',
  'settings.nav.admin.users',
  'admin.federated.title',
  'admin.federated.description',
  'admin.federated.empty',
  'admin.federated.addPeer',
  'admin.federated.nameLabel',
  'admin.federated.baseUrlLabel',
  'admin.federated.secretLabel',
  'admin.federated.create',
  'admin.federated.creating',
  'admin.federated.enable',
  'admin.federated.disable',
  'admin.federated.remove',
  'admin.federated.statusEnabled',
  'admin.federated.statusDisabled',
  'admin.federated.error',
  'admin.users.title',
  'admin.users.description',
  'admin.users.invite',
] as const;

describe('G1 i18n keys exist in all locales', () => {
  for (const locale of [['en', en], ['es', es], ['ar', ar]] as const) {
    const [name, dict] = locale;
    it(`${name} has every G1 key and none is empty`, () => {
      for (const key of REQUIRED) {
        expect(Object.hasOwn(dict, key), `${name} missing ${key}`).toBe(true);
        expect((dict as Record<string, string>)[key]?.length ?? 0).toBeGreaterThan(0);
      }
    });
  }
});
```

2. **Run to fail.**

```sh
source ~/.zshenv && pnpm vitest run tests/unit/g1-i18n-keys.test.ts
```

Expected output (abridged): `en missing settings.nav.admin.federated` — 3 failed.

3. **Implementation — en.json.** Add these key/value pairs to `messages/en.json` (anywhere in the flat object; place near the other `settings.nav.admin.*` keys):

```json
  "settings.nav.admin.federated": "Federated search",
  "settings.nav.admin.users": "Users",
  "admin.federated.title": "Federated search",
  "admin.federated.description": "Register trusted Cairn instances to search across them. Peers are disabled until you enable them.",
  "admin.federated.empty": "No federated peers configured.",
  "admin.federated.addPeer": "Add peer",
  "admin.federated.nameLabel": "Name",
  "admin.federated.baseUrlLabel": "Base URL",
  "admin.federated.secretLabel": "Shared secret",
  "admin.federated.create": "Add peer",
  "admin.federated.creating": "Adding…",
  "admin.federated.enable": "Enable",
  "admin.federated.disable": "Disable",
  "admin.federated.remove": "Remove",
  "admin.federated.statusEnabled": "Enabled",
  "admin.federated.statusDisabled": "Disabled",
  "admin.federated.error": "Something went wrong. Try again.",
  "admin.users.title": "Users",
  "admin.users.description": "Manage who can access this workspace and their roles.",
  "admin.users.invite": "Invite user"
```

4. **Implementation — es.json.** Add the same keys, Spanish:

```json
  "settings.nav.admin.federated": "Búsqueda federada",
  "settings.nav.admin.users": "Usuarios",
  "admin.federated.title": "Búsqueda federada",
  "admin.federated.description": "Registra instancias de Cairn de confianza para buscar entre ellas. Los pares están deshabilitados hasta que los habilites.",
  "admin.federated.empty": "No hay pares federados configurados.",
  "admin.federated.addPeer": "Agregar par",
  "admin.federated.nameLabel": "Nombre",
  "admin.federated.baseUrlLabel": "URL base",
  "admin.federated.secretLabel": "Secreto compartido",
  "admin.federated.create": "Agregar par",
  "admin.federated.creating": "Agregando…",
  "admin.federated.enable": "Habilitar",
  "admin.federated.disable": "Deshabilitar",
  "admin.federated.remove": "Eliminar",
  "admin.federated.statusEnabled": "Habilitado",
  "admin.federated.statusDisabled": "Deshabilitado",
  "admin.federated.error": "Algo salió mal. Inténtalo de nuevo.",
  "admin.users.title": "Usuarios",
  "admin.users.description": "Gestiona quién puede acceder a este espacio de trabajo y sus roles.",
  "admin.users.invite": "Invitar usuario"
```

5. **Implementation — ar.json.** Add the same keys, Arabic:

```json
  "settings.nav.admin.federated": "البحث الموحّد",
  "settings.nav.admin.users": "المستخدمون",
  "admin.federated.title": "البحث الموحّد",
  "admin.federated.description": "سجّل خوادم Cairn الموثوقة للبحث عبرها. تكون النظائر معطّلة حتى تقوم بتفعيلها.",
  "admin.federated.empty": "لا توجد نظائر موحّدة مُهيّأة.",
  "admin.federated.addPeer": "إضافة نظير",
  "admin.federated.nameLabel": "الاسم",
  "admin.federated.baseUrlLabel": "عنوان URL الأساسي",
  "admin.federated.secretLabel": "السر المشترك",
  "admin.federated.create": "إضافة نظير",
  "admin.federated.creating": "جارٍ الإضافة…",
  "admin.federated.enable": "تفعيل",
  "admin.federated.disable": "تعطيل",
  "admin.federated.remove": "إزالة",
  "admin.federated.statusEnabled": "مفعّل",
  "admin.federated.statusDisabled": "معطّل",
  "admin.federated.error": "حدث خطأ ما. حاول مرة أخرى.",
  "admin.users.title": "المستخدمون",
  "admin.users.description": "أدر من يمكنه الوصول إلى مساحة العمل هذه وأدوارهم.",
  "admin.users.invite": "دعوة مستخدم"
```

6. **Run to pass.**

```sh
source ~/.zshenv && pnpm vitest run tests/unit/g1-i18n-keys.test.ts
```

Expected output: `Test Files  1 passed (1)` · `Tests  3 passed (3)`.

7. **Confirm the i18n audit baseline is unchanged (no NEW hardcoded strings introduced by editing JSON).**

```sh
source ~/.zshenv && pnpm i18n:check
```

Expected: exits 0 (JSON edits add no JSX string literals).

8. **Commit.**

```sh
git add messages/en.json messages/es.json messages/ar.json tests/unit/g1-i18n-keys.test.ts && git commit -m "feat(i18n): en/es/ar keys for federated-search + users admin pages"
```

---

## Task 5 — Federated-search admin page + nav child

**Problem:** Build the `/settings/admin/federated` page (admin-gated RSC that reuses `canFederate()`, lists peers via `listPeers`, and renders a client manager that talks to the Task 3 API), and surface it as an `adminChildren` nav item.

### Files
- **Create** `src/app/(app)/settings/admin/federated/page.tsx` — RSC: `requireRole('admin')`, gate on `canFederate(ctx.role)`, fetch `listPeers`, render manager.
- **Create** `src/app/(app)/settings/admin/federated/federated-manager.tsx` — `'use client'`: add-peer form + per-row enable/disable + remove, calls the API, `router.refresh()`.
- **Modify** `src/components/settings/sidebar.tsx` — add `admin-federated` child to `adminChildren`.
- **Create** `tests/a11y/g1-admin-routes.spec.ts` — Playwright a11y + the two required e2e assertions (Admin parent nav, SSO redirect).

### Steps

1. **Write the failing e2e/a11y test.** Create `tests/a11y/g1-admin-routes.spec.ts`:

```ts
import { DARK_INIT } from '../../playwright.config';
import { expectNoA11yViolations } from './axe';
import { expect, signIn, test } from './fixtures';

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'dark') {
    await page.addInitScript(DARK_INIT);
  }
});

test.describe('G1 admin IA (audit items A, B)', () => {
  test('Admin sidebar parent navigates to the audit page', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/settings/account');
    // The seeded user is workspace owner → admin-gated nav is visible.
    await page.getByRole('link', { name: 'Admin', exact: true }).click();
    await page.waitForURL('**/settings/admin/audit');
    expect(page.url()).toContain('/settings/admin/audit');
  });

  test('legacy /admin/sso redirects into the settings hub', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/admin/sso');
    await page.waitForURL('**/settings/admin/sso');
    expect(page.url()).toContain('/settings/admin/sso');
    await expect(page.getByRole('heading', { name: 'Single sign-on' })).toBeVisible();
  });

  test('legacy SSO deep link redirects with the path preserved', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/admin/sso/oidc/new');
    await page.waitForURL('**/settings/admin/sso/oidc/new');
    expect(page.url()).toContain('/settings/admin/sso/oidc/new');
  });

  test('/settings/admin/federated is axe-clean', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/settings/admin/federated');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Federated search' })).toBeVisible();
    await expectNoA11yViolations(page, '/settings/admin/federated');
  });

  test('/settings/admin/users is axe-clean', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/settings/admin/users');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
    await expectNoA11yViolations(page, '/settings/admin/users');
  });
});
```

2. **Run to fail.** (Playwright builds + boots the standalone app; the federated/users routes don't exist yet, and `/settings/admin/users` heading won't appear.)

```sh
source ~/.zshenv && pnpm build && pnpm exec playwright test tests/a11y/g1-admin-routes.spec.ts --project=light
```

Expected: the `Admin parent navigates` + `legacy /admin/sso` + deep-link tests PASS (Tasks 1–2 landed); the `/settings/admin/federated` and `/settings/admin/users` tests FAIL (404 / heading not visible). Note this is the red checkpoint for Tasks 5+6.

3. **Implementation — the client manager.** Create `src/app/(app)/settings/admin/federated/federated-manager.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';
import type { PeerSummary } from '@/lib/search/peer-admin';

export function FederatedManager({ peers }: { peers: PeerSummary[] }) {
  const t = useT();
  const router = useRouter();
  const nameId = useId();
  const urlId = useId();
  const secretId = useId();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addPeer(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/federated/peers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, baseUrl, sharedSecret: secret }),
      });
      if (!res.ok) {
        setError(t('admin.federated.error'));
        return;
      }
      setName('');
      setBaseUrl('');
      setSecret('');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function toggle(peerId: string, enabled: boolean) {
    setError(null);
    setBusyId(peerId);
    try {
      const res = await fetch(`/api/admin/federated/peers/${peerId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        setError(t('admin.federated.error'));
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(peerId: string) {
    setError(null);
    setBusyId(peerId);
    try {
      const res = await fetch(`/api/admin/federated/peers/${peerId}`, { method: 'DELETE' });
      if (!res.ok) {
        setError(t('admin.federated.error'));
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {error ? (
        <div
          role="alert"
          className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      <form onSubmit={addPeer} className="mb-6 flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label htmlFor={nameId} className="text-xs text-muted-foreground">
            {t('admin.federated.nameLabel')}
          </label>
          <input
            id={nameId}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </div>
        <div className="flex flex-col">
          <label htmlFor={urlId} className="text-xs text-muted-foreground">
            {t('admin.federated.baseUrlLabel')}
          </label>
          <input
            id={urlId}
            type="url"
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="rounded border px-2 py-1"
            placeholder="https://peer.example.com"
          />
        </div>
        <div className="flex flex-col">
          <label htmlFor={secretId} className="text-xs text-muted-foreground">
            {t('admin.federated.secretLabel')}
          </label>
          <input
            id={secretId}
            type="password"
            required
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? t('admin.federated.creating') : t('admin.federated.create')}
        </Button>
      </form>

      {peers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('admin.federated.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {peers.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded border bg-card p-3">
              <div className="flex-1">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  {p.baseUrl} ·{' '}
                  {p.enabled
                    ? t('admin.federated.statusEnabled')
                    : t('admin.federated.statusDisabled')}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busyId === p.id}
                onClick={() => toggle(p.id, !p.enabled)}
              >
                {p.enabled ? t('admin.federated.disable') : t('admin.federated.enable')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busyId === p.id}
                aria-label={`${t('admin.federated.remove')} ${p.name}`}
                onClick={() => remove(p.id)}
              >
                {t('admin.federated.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

4. **Implementation — the RSC page.** Create `src/app/(app)/settings/admin/federated/page.tsx`:

```tsx
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { canFederate } from '@/app/(app)/search/can-federate';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { getMessages } from '@/lib/i18n/server';
import { listPeers } from '@/lib/search/peer-admin';
import { FederatedManager } from './federated-manager';

export const dynamic = 'force-dynamic';

export default async function FederatedAdminPage() {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/');
  // Mirror the search route: cross-instance federation is admin/owner-only.
  if (!canFederate(ctx.role)) redirect('/settings/admin/audit');
  const peers = await listPeers(getDb(), ctx.workspaceId);
  const { t } = await getMessages();
  return (
    <section className="space-y-6">
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin/audit' as Route }}
        page={t('admin.federated.title')}
      />
      <header>
        <h1 className="text-xl font-semibold">{t('admin.federated.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.federated.description')}</p>
      </header>
      <FederatedManager peers={peers} />
    </section>
  );
}
```

> **Server-side `t()` note:** if `@/lib/i18n/server`'s `getMessages` helper does not exist or exposes a different shape, fall back to the SAME pattern the sibling SIEM page uses (a client wrapper that calls `useT()`); confirm by reading `src/app/(app)/settings/admin/siem/forwarders-view.tsx`. The breadcrumb `page=` and `header` strings MUST still resolve through i18n. If only client `useT()` is available, move the `<header>` + breadcrumb label rendering into `FederatedManager` (or a thin client header component) so no English literal is hardcoded in the RSC.

5. **Add the nav child.** In `src/components/settings/sidebar.tsx`, add to `adminChildren` (after the `admin-siem` entry, around line 50):

```tsx
      {
        id: 'admin-federated',
        label: t('settings.nav.admin.federated'),
        href: '/settings/admin/federated' as Route,
      },
```

6. **Run to pass (federated slice).**

```sh
source ~/.zshenv && pnpm build && pnpm exec playwright test tests/a11y/g1-admin-routes.spec.ts --project=light -g "federated"
```

Expected: `1 passed` (the `/settings/admin/federated is axe-clean` test).

7. **Commit.**

```sh
git add "src/app/(app)/settings/admin/federated" src/components/settings/sidebar.tsx tests/a11y/g1-admin-routes.spec.ts && git commit -m "feat(admin): federated-search peer-management page + nav child"
```

---

## Task 6 — Dedicated user-management page + repoint members nav child

**Problem:** Section 3 G1: build a dedicated `/settings/admin/users` page (list/invite/role-change/remove) instead of cross-linking to `/settings/workspace/members`, and repoint the `admin-members` nav child to it. Reuse the existing `listWorkspaceMembers`, `MembersTable`, and `InvitesManager` components + their existing API routes — no new backend.

### Files
- **Create** `src/app/(app)/settings/admin/users/page.tsx` — RSC: `requireRole('admin')`, lists members + pending invites, renders the reused `InvitesManager` + `MembersTable`.
- **Modify** `src/components/settings/sidebar.tsx` — repoint `admin-members` child (line 44) href from `/settings/workspace/members` to `/settings/admin/users`.
- **Create** `tests/unit/admin-users-nav.test.tsx` — assert the `admin-members` child now targets `/settings/admin/users`.

### Steps

1. **Write the failing test.** Create `tests/unit/admin-users-nav.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsSidebar } from '@/components/settings/sidebar';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';

describe('Admin > Members nav child points at the dedicated users page', () => {
  it('uses /settings/admin/users, not the workspace members cross-link', () => {
    // Render on an admin route so the Admin section is expanded and its
    // children are in the DOM (the section renders children only when active).
    render(
      <I18nProvider locale="en" messages={en as Record<string, string>}>
        <SettingsSidebar isAdmin />
      </I18nProvider>,
    );
    // Force the Admin group open by simulating the active path is not needed:
    // children only render when active. Instead assert the dedicated child via
    // its stable label once expanded. We expand by checking the link exists in
    // the section model: render again with the admin route active is covered by
    // the e2e a11y spec; here we assert the model via the audit child presence.
    const members = screen.queryByRole('link', { name: en['settings.nav.admin.members'] });
    // On a non-admin pathname the children are collapsed, so this may be null;
    // the load-bearing assertion is the href when present.
    if (members) {
      expect(members).toHaveAttribute('href', '/settings/admin/users');
    }
  });
});
```

> **Note:** the sidebar only renders a section's children when that section is `active` (matches the current pathname). In a unit render `usePathname()` returns `''`, so children are collapsed. The authoritative assertion for the href therefore lives in the e2e spec (Task 5's `/settings/admin/users is axe-clean` reaches the page directly). This unit test guards the model when present. To make the unit test deterministic instead, mock the pathname:

   Prepend this `vi.mock` to the test file (above the imports' usage), so `usePathname` returns an admin route and children render:

```tsx
import { vi } from 'vitest';
vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/admin/audit',
}));
```

   With the mock, replace the `if (members)` block with a hard assertion:

```tsx
    const members = screen.getByRole('link', { name: en['settings.nav.admin.members'] });
    expect(members).toHaveAttribute('href', '/settings/admin/users');
```

2. **Run to fail.**

```sh
source ~/.zshenv && pnpm vitest run tests/unit/admin-users-nav.test.tsx
```

Expected output (abridged): `AssertionError: expected '/settings/workspace/members' to equal '/settings/admin/users'` — 1 failed.

3. **Implementation — repoint the nav child.** In `src/components/settings/sidebar.tsx`, change the `admin-members` child (lines 41–45) and its comment:

```tsx
      // Dedicated workspace user-management surface (audit item A). Replaces
      // the old cross-link into Workspace > Members.
      {
        id: 'admin-members',
        label: t('settings.nav.admin.members'),
        href: '/settings/admin/users' as Route,
      },
```

4. **Run to pass (nav).**

```sh
source ~/.zshenv && pnpm vitest run tests/unit/admin-users-nav.test.tsx
```

Expected output: `Test Files  1 passed (1)` · `Tests  1 passed (1)`.

5. **Implementation — the page.** Create `src/app/(app)/settings/admin/users/page.tsx`. It reuses the existing member lib + the existing client components. Pending invites are loaded the same way the workspace invites page does; confirm the loader by reading `src/app/(app)/settings/workspace/invites/page.tsx` and mirror its `listWorkspaceInvites` (or equivalent) call — substitute the exact import below if the name differs:

```tsx
import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { getMessages } from '@/lib/i18n/server';
import { listWorkspaceInvites } from '@/lib/workspaces/invites';
import { listWorkspaceMembers } from '@/lib/workspaces/admin-members';
import { InvitesManager } from '@/app/(app)/settings/workspace/invites/invites-manager';
import { MembersTable } from '@/app/(app)/settings/workspace/members/members-table';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const ctx = await requireRole('admin');
  const db = getDb();
  const members = await listWorkspaceMembers(db, ctx.workspaceId);
  const invites = await listWorkspaceInvites(db, ctx.workspaceId);
  const { t } = await getMessages();
  return (
    <section className="space-y-8">
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin/audit' as Route }}
        page={t('admin.users.title')}
      />
      <header>
        <h1 className="text-xl font-semibold">{t('admin.users.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.users.description')}</p>
      </header>

      <InvitesManager
        workspaceId={ctx.workspaceId}
        invites={invites.map((inv) => ({
          id: inv.id,
          email: inv.email,
          role: inv.role,
          token: inv.token,
          expiresAt: inv.expiresAt.toISOString(),
          createdAt: inv.createdAt.toISOString(),
        }))}
      />

      <MembersTable workspaceId={ctx.workspaceId} members={members} currentUserId={ctx.userId} />
    </section>
  );
}
```

> **Invite loader note:** `src/app/(app)/settings/workspace/invites/page.tsx` already builds the `invites` array passed to `InvitesManager`. READ it and copy its exact loader call + the precise shape mapping (field names, Date→ISO conversions). If it inlines a Drizzle query rather than a `listWorkspaceInvites` helper, inline the SAME query here (do not invent a helper that doesn't exist). The `InvitesManager` prop contract is `{ id, email, role, token, expiresAt: string, createdAt: string }` (see `invites-manager.tsx`). Keep the same `getMessages`/client-`useT()` decision made in Task 5 for the header strings.

6. **Run to pass (users a11y slice).**

```sh
source ~/.zshenv && pnpm build && pnpm exec playwright test tests/a11y/g1-admin-routes.spec.ts --project=light -g "users"
```

Expected: `1 passed` (the `/settings/admin/users is axe-clean` test).

7. **Commit.**

```sh
git add "src/app/(app)/settings/admin/users" src/components/settings/sidebar.tsx tests/unit/admin-users-nav.test.tsx && git commit -m "feat(admin): dedicated user-management page + repoint members nav child"
```

---

## Task 7 — G1 per-group verification gate

**Problem:** Before handing off to G2, the whole group must pass the locked gate (Section 4): `pnpm lint` (0 errors) + `pnpm typecheck` + `pnpm i18n:check` (no NEW findings) + the group's Vitest + full Playwright G1 spec + `pnpm build` (BUILD_EXIT=0). No new code in this task except fixing whatever the gate surfaces.

### Files
- **Modify** (only if the gate fails) any G1 file flagged by lint/typecheck/i18n.

### Steps

1. **Lint (0 errors).** Biome may auto-reorder imports / convert type-only imports — accept those.

```sh
source ~/.zshenv && pnpm lint
```

Expected: `Checked N files ... No fixes needed.` and exit 0. If Biome reports fixable issues, run `source ~/.zshenv && pnpm exec biome check --write src/ tests/ messages/ next.config.mjs` and re-run `pnpm lint` until 0 errors.

2. **Typecheck.**

```sh
source ~/.zshenv && pnpm typecheck
```

Expected: exit 0, no output.

3. **i18n audit (no NEW findings).**

```sh
source ~/.zshenv && pnpm i18n:check
```

Expected: exit 0. If it flags a hardcoded string in a new page/component, route it through `t(...)` (and add the key to all three locale files per Task 4's pattern), then re-run.

4. **Group Vitest (all G1 unit + integration tests).**

```sh
source ~/.zshenv && pnpm vitest run tests/unit/settings-admin-nav.test.tsx tests/unit/next-redirects.test.ts tests/integration/peer-admin.test.ts tests/unit/g1-i18n-keys.test.ts tests/unit/admin-users-nav.test.tsx
```

Expected: `Test Files  5 passed (5)`; all tests green. (Testcontainers requires Docker/Colima up — `source ~/.zshenv && colima status` first; `colima start` if down.)

5. **Full G1 Playwright spec (both projects).**

```sh
source ~/.zshenv && pnpm build && pnpm exec playwright test tests/a11y/g1-admin-routes.spec.ts
```

Expected: all G1 e2e/a11y tests pass across `light` + `dark` projects — Admin parent nav lands on `/settings/admin/audit`, `/admin/sso` + deep link redirect into the hub, and both new admin pages are axe-clean. (Re-run on a self-hosted-runner flake, per Section 5 — do not "fix" a 137/255/SIGKILL.)

6. **Build (BUILD_EXIT=0).**

```sh
source ~/.zshenv && pnpm build; echo "BUILD_EXIT=$?"
```

Expected: `BUILD_EXIT=0`. (The in-build TS phase is skipped per `next.config.mjs`; types are gated by step 2.)

7. **Commit (only if step 1/3 required edits; otherwise skip).**

```sh
git add -A && git commit -m "chore(g1): pass lint/typecheck/i18n gate for admin & SSO IA"
```

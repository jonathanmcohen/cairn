# v0.9.9 Plan B — Per-page ACL UI ("Share & permissions")

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal.** Close issue **#259** (P0 / v0.7.0 headline that never passed UI acceptance): the per-page access-control backend shipped in v0.7.0 (table `page_acls`, resolver `requirePageAcl`, `setPageAcl`/`removePageAcl`, list helper, and the `PageAclManager` component) but was never reachable from the page UI for an **unpublished** page. The "Manage sharing…" entry that mounts `ShareDialog → SharePanel → PageAclManager` only renders in the page ⋯ menu when `published === true` (`src/components/page-menu.tsx:178-218`). For a private page there is **no path at all** to grant/revoke per-member access. This plan is **wire-up + drawer UI, not a rebuild**: surface the existing manager as an always-available "Share & permissions" entry, then extend the manager and backend with the three pieces the v0.7.0 headline promised but never built — **invite by email + role (reader/commenter/editor/owner)**, **pending invites**, and **transfer ownership** — and rename the audit vocabulary to the documented `page.permission_granted` / `page.permission_revoked` events (keeping the legacy `page_acl.*` events as aliases for SIEM back-compat).

**Architecture.** Cairn is workspace-scoped multi-tenant. Two access layers already coexist: v0.6 role-based `requirePageAccess` and v0.7 ACL-aware `requirePageAcl(pageId, minPermission)` (`src/lib/pages/acl.ts`) which walks `pages.parent_id` upward, LEFT JOINs `page_acls(user_id)`, and falls back to workspace role (`owner→'owner'`, `admin/editor→'edit'`, `viewer→'view'`). The ACL permission tier enum is `'view' | 'comment' | 'edit'` in storage and `'view' | 'comment' | 'edit' | 'owner'` as the resolved `EffectivePermission` (`'owner'` is the workspace-owner bypass, never stored on a row). This plan keeps that resolver untouched and adds: (1) an `'owner'` **stored** ACL tier for page-level ownership transfer; (2) an `page_acl_invites` table for email invitations to not-yet-members; (3) UI surfacing. Every mutation goes through the lib layer (db-injected, unit-testable) and records an audit row; routes are gated by `requirePageAcl(pageId, 'edit')` for grants and `'owner'` for ownership transfer.

**Tech Stack.** Next.js 16 App Router (`proxy.ts` auth gate, nodejs runtime), React 19, TypeScript 6 strict, Drizzle ORM + Postgres 16 (migrations applied at startup via `src/server/entrypoint.ts`), Biome v2 (0-error gate), Vitest 4 + Testcontainers v12 (real Postgres, isolation ON), Tailwind v4 + shadcn/ui (new-york), i18n en/es/ar via `useT()` from `src/lib/i18n/provider`. New strings live in `messages/{en,es,ar}.json` (flat dot-keyed). Migrations: latest applied is **0061**; this plan owns **0062** (`page_acl_invites` table + `page_acls.permission` now permits `'owner'`).

> **Branch:** single PR onto `patches/v0.9.9`. **HOLD for GO** before dispatching implementers. GitHub-hosted runners only. Zero-deferral. Full `pnpm vitest run` per gate.

---

## B1 — Audit & confirm the existing ACL backend (no code; documented baseline)

This is a **read-only confirmation step** so the implementer starts from facts, not assumptions. No commit. Confirm each of the following exists exactly as described, and record any drift as a blocker for the controller before proceeding to B2.

**Files (read-only — confirm, do NOT modify here):**
- Confirm `src/db/schema/page-acls.ts` — table `page_acls` (`id`, `page_id` FK→pages cascade, `user_id` FK→users cascade, `permission text NOT NULL` documented as `'view'|'comment'|'edit'`, `created_at`, `updated_at`, unique index `page_acls_page_user_unique` on `(page_id, user_id)`). Type alias `PageAclPermission = 'view' | 'comment' | 'edit'` (line 27).
- Confirm `src/lib/pages/acl.ts` — `EffectivePermission = 'view'|'comment'|'edit'|'owner'` with `ORDER` map (view=1…owner=4), `permissionAtLeast`, `resolveEffectivePermission` (role short-circuit for `owner`, recursive CTE up `parent_id`, nearest non-null ACL), `requirePageAcl(pageId, minPermission)` (404 non-UUID / cross-workspace, 403 below tier), `setPageAcl` (upsert + audit `page_acl.created`/`page_acl.changed`), `removePageAcl` (delete + audit `page_acl.removed`, idempotent).
- Confirm `src/lib/pages/acl-list.ts` — `listPageAcls(db, pageId)` joins `users`, returns `{userId,name,email,image,permission}[]` ordered by name, filters to the three valid tiers.
- Confirm `src/app/api/pages/[pageId]/acls/route.ts` — **GET** (gated `requirePageAcl(pageId,'edit')`, returns `{acls}`), **PUT** (`{userId, permission}`, validates target is a workspace member, calls `setPageAcl`), **DELETE** (`{userId}`, calls `removePageAcl`). NOTE: the route uses **PUT** for upsert, not POST — the scope doc's "POST" refers to "a create/update verb"; the existing verb is PUT and the plan keeps it.
- Confirm `src/components/pages/page-acl-manager.tsx` — `PageAclManager({pageId})`, fetches `/api/pages/${pageId}/acls`, member search via `/api/workspaces/members?q=`, grant via PUT, remove via themed `useConfirm()` + DELETE. Mounts inside `src/components/pages/share-panel.tsx:186` (`<PageAclManager pageId={pageId} />`).
- Confirm `src/components/pages/share-dialog.tsx` renders `SharePanel`, and `src/components/page-menu.tsx:178-218` only renders the `t('share.manage')` button (which opens `ShareDialog`) inside the `published` branch — **this is the #259 root cause**.

**Steps:**
- [ ] Run `source ~/.zshenv && pnpm vitest run src/lib/pages` and capture the existing ACL test files (expect green) — this is the regression baseline the new tests extend, not replace.
- [ ] Grep-confirm the audit vocabulary: `source ~/.zshenv && grep -n "page_acl\." src/lib/audit/actions.ts` shows `page_acl.created`, `page_acl.changed`, `page_acl.removed` (lines 30-32) and target type `'page_acl'` (line 174).
- [ ] Write a one-paragraph drift note in the PR description body draft (NOT a repo file): "Backend confirmed present; #259 is a wiring gap — Share entry gated on `published` in page-menu.tsx:178." No commit for B1.

---

## B2 — Surface "Share & permissions" from the page ⋯ menu (the #259 fix)

Make the Share dialog reachable for **every** page (published or not) from the ⋯ menu, and rename it to "Share & permissions" so users know permissions live there. The dialog already mounts `PageAclManager`; the only defect is that the menu entry is buried inside the `published` branch.

**Files:**
- Modify `src/components/page-menu.tsx` (move the share button out of the `published` branch).
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json` (add `share.menuLabel`).
- Create `src/components/page-menu.test.tsx` (component test: the share entry renders for an unpublished page and opens the dialog).

**Steps:**
- [ ] Add the i18n key to all three catalogs. Insert next to the existing `"share.manage"` key (en.json line ~200):

  `messages/en.json`:
  ```json
  "share.menuLabel": "Share & permissions",
  ```
  `messages/es.json`:
  ```json
  "share.menuLabel": "Compartir y permisos",
  ```
  `messages/ar.json`:
  ```json
  "share.menuLabel": "المشاركة والأذونات",
  ```

- [ ] **Write failing test** `src/components/page-menu.test.tsx`: render `<PageMenu pageId="…" initialPublished={false} />` inside the i18n provider, open the menu, assert a button with name `Share & permissions` exists and that clicking it opens a dialog with `share.title` ("Share this page"). Use the existing test-render helper pattern (wrap in `I18nProvider`/`ConfirmProvider`; mock `useActionAllowed` to return `true`).
  ```tsx
  it('exposes Share & permissions for an unpublished page', async () => {
    renderWithProviders(<PageMenu pageId="11111111-1111-4111-8111-111111111111" initialPublished={false} />);
    await userEvent.click(screen.getByRole('button', { name: /page actions menu|⋯/i }));
    const share = screen.getByRole('button', { name: /share & permissions/i });
    expect(share).toBeInTheDocument();
    await userEvent.click(share);
    expect(await screen.findByText(/share this page/i)).toBeInTheDocument();
  });
  ```
- [ ] **Run to fail:** `source ~/.zshenv && pnpm vitest run src/components/page-menu.test.tsx` (fails — entry only renders when published).
- [ ] **Minimal impl:** in `src/components/page-menu.tsx`, lift the share button out of the `published === true` branch into an always-rendered menu item, retitle it `t('share.menuLabel')`, keep the `LinkIcon`, keep `disabled={!shareAllowed}` + offline title. Leave Publish/Unpublish where they are. Concretely, replace the share `<button>` currently nested under the `published` `<>` (page-menu.tsx:204-216) with an unconditional item placed immediately after the publish/unpublish block:
  ```tsx
  <button
    type="button"
    className={ITEM_CLASS}
    disabled={!shareAllowed}
    title={shareAllowed ? undefined : t('pageMenu.unavailableOffline')}
    onClick={() => {
      setShareOpen(true);
      setOpen(false);
    }}
  >
    <LinkIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
    {t('share.menuLabel')}
  </button>
  ```
- [ ] **Run to pass:** `source ~/.zshenv && pnpm vitest run src/components/page-menu.test.tsx`.
- [ ] **Commit:** `fix(pages): surface Share & permissions from page menu for all pages (#259)`

---

## B3 — Add stored `'owner'` ACL tier + ownership-transfer lib & route (migration 0062 part A)

Page-level ownership transfer requires a stored `'owner'` ACL row (the resolver's `'owner'` today is only the workspace-owner bypass, never persisted). Widen the stored permission enum to include `'owner'`, teach the resolver to read it, and add transfer logic + an audit event.

**Files:**
- Create `drizzle/migrations/0062_page_acl_invites_and_owner.sql` (this migration also covers B4's invites table; the `'owner'` widening is a no-op at the DB level because `permission` is `text`, but we add a CHECK constraint to lock the closed set).
- Modify `src/db/schema/page-acls.ts` (widen `PageAclPermission` type + table comment).
- Modify `src/lib/pages/acl.ts` (`resolveEffectivePermission` reads a stored `'owner'` row; `setPageAcl` accepts `'owner'`; new `transferPageOwnership`).
- Modify `src/lib/pages/acl-list.ts` (include `'owner'` in the valid-tier filter + type).
- Create `src/lib/pages/acl-transfer.test.ts`.

**Steps:**
- [ ] **Write the migration** `drizzle/migrations/0062_page_acl_invites_and_owner.sql` (full SQL — invites table belongs to B4 but ships in the same numbered file; hand-appended CHECK + FK since `db:generate` omits them):
  ```sql
  -- 0062 — per-page ACL UI (#259): stored 'owner' tier + email invites.

  -- A) Lock page_acls.permission to the closed set, now including 'owner'.
  ALTER TABLE "page_acls"
    ADD CONSTRAINT "page_acls_permission_check"
    CHECK ("permission" IN ('view', 'comment', 'edit', 'owner'));

  -- B) Email invitations to grant page access to not-yet-members.
  CREATE TABLE "page_acl_invites" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "page_id" uuid NOT NULL,
    "workspace_id" uuid NOT NULL,
    "email" text NOT NULL,
    "permission" text NOT NULL,
    "token" text NOT NULL,
    "invited_by" uuid NOT NULL,
    "accepted_at" timestamptz,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "expires_at" timestamptz NOT NULL
  );

  ALTER TABLE "page_acl_invites"
    ADD CONSTRAINT "page_acl_invites_page_id_fk"
    FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade;
  ALTER TABLE "page_acl_invites"
    ADD CONSTRAINT "page_acl_invites_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade;
  ALTER TABLE "page_acl_invites"
    ADD CONSTRAINT "page_acl_invites_invited_by_fk"
    FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE cascade;
  ALTER TABLE "page_acl_invites"
    ADD CONSTRAINT "page_acl_invites_permission_check"
    CHECK ("permission" IN ('view', 'comment', 'edit', 'owner'));

  CREATE UNIQUE INDEX "page_acl_invites_token_unique" ON "page_acl_invites" ("token");
  -- One live (un-accepted) invite per (page,email): partial unique index.
  CREATE UNIQUE INDEX "page_acl_invites_page_email_pending_unique"
    ON "page_acl_invites" ("page_id", lower("email"))
    WHERE "accepted_at" IS NULL;
  CREATE INDEX "page_acl_invites_page_idx" ON "page_acl_invites" ("page_id");
  ```
- [ ] Modify `src/db/schema/page-acls.ts`: change the type alias and the inline comment to include `'owner'`:
  ```ts
  // 'view' | 'comment' | 'edit' | 'owner' — enforced by CHECK (migration 0062)
  // and the lib layer (resolveEffectivePermission / setPageAcl).
  permission: text('permission').notNull(),
  ```
  ```ts
  export type PageAclPermission = 'view' | 'comment' | 'edit' | 'owner';
  ```
- [ ] **Write failing test** `src/lib/pages/acl-transfer.test.ts` (Testcontainers, TRUNCATE in `beforeEach`): seed a workspace with an `owner` (acts as actor) + two `editor` members A and B and a page. Assert (1) `resolveEffectivePermission` returns `'owner'` for a member who has a **stored** `'owner'` ACL row even though their workspace role is `editor`; (2) `transferPageOwnership(db,{pageId, fromUserId:A, toUserId:B, workspaceId, actorUserId})` writes an `'owner'` ACL for B, demotes A's stored row to `'edit'`, and records a `page.ownership_transferred` audit row with metadata `{fromUserId, toUserId}`.
  ```ts
  it('resolves a stored owner ACL above the editor role', async () => {
    await setPageAcl(db, { workspaceId, pageId, userId: editorA, permission: 'owner', actorUserId: wsOwner });
    expect(await resolveEffectivePermission(db, { userId: editorA, pageId })).toBe('owner');
  });
  it('transfers page ownership and demotes the prior owner', async () => {
    await setPageAcl(db, { workspaceId, pageId, userId: editorA, permission: 'owner', actorUserId: wsOwner });
    await transferPageOwnership(db, { workspaceId, pageId, fromUserId: editorA, toUserId: editorB, actorUserId: editorA });
    expect(await resolveEffectivePermission(db, { userId: editorB, pageId })).toBe('owner');
    const acls = await listPageAcls(db, pageId);
    expect(acls.find((a) => a.userId === editorA)?.permission).toBe('edit');
  });
  ```
- [ ] **Run to fail:** `source ~/.zshenv && pnpm vitest run src/lib/pages/acl-transfer.test.ts`.
- [ ] **Minimal impl** in `src/lib/pages/acl.ts`:
  - Add `'owner'` to the accepted union in `SetPageAclInput.permission` and to the `hit.permission` guard in `resolveEffectivePermission` so a stored `'owner'` row resolves to `'owner'`:
    ```ts
    if (hit?.permission === 'view' || hit?.permission === 'comment'
      || hit?.permission === 'edit' || hit?.permission === 'owner') {
      return hit.permission;
    }
    ```
    and change the `AclRow` type's `permission` member to `'view' | 'comment' | 'edit' | 'owner' | null`, and `SetPageAclInput.permission` to `'view' | 'comment' | 'edit' | 'owner'`.
  - Add `transferPageOwnership`:
    ```ts
    export type TransferPageOwnershipInput = {
      workspaceId: string;
      pageId: string;
      fromUserId: string;
      toUserId: string;
      actorUserId: string;
    };

    export async function transferPageOwnership(
      db: PostgresJsDatabase<typeof schema>,
      input: TransferPageOwnershipInput,
    ): Promise<void> {
      await db.transaction(async (tx) => {
        // Grant the new owner.
        await tx
          .insert(schema.pageAcls)
          .values({ pageId: input.pageId, userId: input.toUserId, permission: 'owner' })
          .onConflictDoUpdate({
            target: [schema.pageAcls.pageId, schema.pageAcls.userId],
            set: { permission: 'owner', updatedAt: new Date() },
          });
        // Demote the prior owner to edit (idempotent; no-op if they had no row).
        await tx
          .update(schema.pageAcls)
          .set({ permission: 'edit', updatedAt: new Date() })
          .where(
            and(
              eq(schema.pageAcls.pageId, input.pageId),
              eq(schema.pageAcls.userId, input.fromUserId),
            ),
          );
        await recordAudit(tx, {
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          action: 'page.ownership_transferred',
          targetType: 'page_acl',
          targetId: input.pageId,
          metadata: { fromUserId: input.fromUserId, toUserId: input.toUserId },
        });
      });
    }
    ```
    (`page.ownership_transferred` is added to the audit vocabulary in B5; the test mocks `recordAudit`'s table, so it compiles once B5's enum lands — to keep B3 self-contained, the implementer adds `'page.ownership_transferred'` to `AUDIT_ACTIONS` in this commit and the label in B5.)
- [ ] Modify `src/lib/pages/acl-list.ts`: add `'owner'` to `PageAclListItem.permission` and to the valid-tier guard in the `flatMap`.
- [ ] **Run to pass:** `source ~/.zshenv && pnpm vitest run src/lib/pages/acl-transfer.test.ts`.
- [ ] **Commit:** `feat(pages): stored owner ACL tier + page ownership transfer (#259)`

---

## B4 — Email-invite lib + route (pending invites to not-yet-members)

The headline promised "invite by email". Today `PageAclManager` can only grant to **existing** workspace members (the PUT route 400s on a non-member). Add invitations: an editor invites an email + role; a `page_acl_invites` row is created; when that email later joins the workspace (or accepts via token) the grant materializes. This plan ships the invite **creation + listing + revoke** path and the **accept-on-membership** hook; full email delivery reuses the existing BYO-SMTP notifier.

**Files:**
- Create `src/db/schema/page-acl-invites.ts` (Drizzle table mirroring migration 0062 part B).
- Modify `src/db/schema/index.ts` (export the new table).
- Create `src/lib/pages/acl-invites.ts` (`createPageAclInvite`, `listPageAclInvites`, `revokePageAclInvite`, `acceptInvitesForNewMember`).
- Create `src/app/api/pages/[pageId]/acl-invites/route.ts` (GET list, POST create, DELETE revoke).
- Create `src/lib/pages/acl-invites.test.ts`.

**Steps:**
- [ ] Create `src/db/schema/page-acl-invites.ts`:
  ```ts
  import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
  import { pages } from './pages';
  import { users } from './users';
  import { workspaces } from './workspaces';

  export const pageAclInvites = pgTable(
    'page_acl_invites',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      pageId: uuid('page_id')
        .notNull()
        .references(() => pages.id, { onDelete: 'cascade' }),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspaces.id, { onDelete: 'cascade' }),
      email: text('email').notNull(),
      // 'view' | 'comment' | 'edit' | 'owner' — CHECK in migration 0062.
      permission: text('permission').notNull(),
      token: text('token').notNull(),
      invitedBy: uuid('invited_by')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
      acceptedAt: timestamp('accepted_at', { withTimezone: true }),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (t) => ({
      tokenUnique: uniqueIndex('page_acl_invites_token_unique').on(t.token),
      pageIdx: index('page_acl_invites_page_idx').on(t.pageId),
    }),
  );

  export type PageAclInvite = typeof pageAclInvites.$inferSelect;
  export type NewPageAclInvite = typeof pageAclInvites.$inferInsert;
  ```
  Add `export * from './page-acl-invites';` to `src/db/schema/index.ts` (or the explicit re-export pattern used there — match the existing style).
- [ ] **Write failing test** `src/lib/pages/acl-invites.test.ts` (Testcontainers): assert (1) `createPageAclInvite` inserts a row with a random `token`, a 14-day `expiresAt`, `permission='comment'`, and audit `page.permission_invited`; (2) a second create for the same `(page,email)` while the first is un-accepted throws (partial-unique conflict surfaced as a 409-style error); (3) `listPageAclInvites` returns only un-accepted, non-expired rows; (4) `acceptInvitesForNewMember(db,{workspaceId,userId,email})` for an email with a pending invite writes a `page_acls` row at the invited permission, stamps `accepted_at`, and records `page.permission_granted`; (5) `revokePageAclInvite` deletes the row + audits `page.permission_invite_revoked`.
  ```ts
  it('materializes a pending invite when the invitee joins', async () => {
    await createPageAclInvite(db, { workspaceId, pageId, email: 'NEW@x.io', permission: 'comment', invitedBy: wsOwner });
    await acceptInvitesForNewMember(db, { workspaceId, userId: newUserId, email: 'new@x.io' });
    const acls = await listPageAcls(db, pageId);
    expect(acls.find((a) => a.userId === newUserId)?.permission).toBe('comment');
    const pending = await listPageAclInvites(db, pageId);
    expect(pending).toHaveLength(0);
  });
  ```
- [ ] **Run to fail:** `source ~/.zshenv && pnpm vitest run src/lib/pages/acl-invites.test.ts`.
- [ ] **Minimal impl** `src/lib/pages/acl-invites.ts`: email is lower-cased on write and matched case-insensitively; `token` is `crypto.randomUUID()` (sufficient — the invite is workspace-scoped and the row is also keyed by email); `expiresAt = now + 14d`. `createPageAclInvite` catches the partial-unique violation and throws `new HttpError(409, 'An invite for this email is already pending')`. `acceptInvitesForNewMember` runs inside the existing member-add transaction is **out of scope to wire here**; expose the function and unit-test it directly. Each function records audit via `recordAudit` with actions: `page.permission_invited`, `page.permission_invite_revoked` (added to `AUDIT_ACTIONS` in B5; add them in this commit too), and reuses `page.permission_granted` for the materialized grant. Target type `page_acl_invite` (added to `AuditTargetType` in B5).
- [ ] Create `src/app/api/pages/[pageId]/acl-invites/route.ts` mirroring the `acls` route's error funnel:
  ```ts
  const PostBody = z.object({
    email: z.email(),
    permission: z.enum(['view', 'comment', 'edit', 'owner']),
  });
  const DeleteBody = z.object({ inviteId: z.uuid() });

  export async function GET(_req, { params }) {
    const { pageId } = await params;
    await requirePageAcl(pageId, 'edit');
    return NextResponse.json({ invites: await listPageAclInvites(getDb(), pageId) });
  }
  export async function POST(req, { params }) {
    const { pageId } = await params;
    const { page, ctx } = await requirePageAcl(pageId, 'edit');
    const body = PostBody.parse(await req.json());
    // 'owner' invites require page-owner tier on the actor.
    if (body.permission === 'owner') await requirePageAcl(pageId, 'owner');
    await createPageAclInvite(getDb(), {
      workspaceId: page.workspaceId, pageId, email: body.email,
      permission: body.permission, invitedBy: ctx.userId,
    });
    return NextResponse.json({ ok: true });
  }
  export async function DELETE(req, { params }) {
    const { pageId } = await params;
    await requirePageAcl(pageId, 'edit');
    const body = DeleteBody.parse(await req.json());
    await revokePageAclInvite(getDb(), { pageId, inviteId: body.inviteId, actorUserId: (await getAuthContext()).userId, workspaceId: (await requirePageAcl(pageId,'edit')).page.workspaceId });
    return NextResponse.json({ ok: true });
  }
  ```
  (Implementer: collapse the double `requirePageAcl` in DELETE into one call that returns `{page, ctx}`; the inline above is illustrative.)
- [ ] **Run to fail then pass** route test: add `src/app/api/pages/[pageId]/acl-invites/route.test.ts` mocking `@/lib/auth/config` with the `__set` session helper (matching the existing acls route-test pattern); assert POST as a `viewer` → 403, POST as `editor` with `permission:'owner'` → 403 (needs page-owner), POST as page-owner with valid email → 200 + row exists.
- [ ] **Run to pass:** `source ~/.zshenv && pnpm vitest run src/lib/pages/acl-invites.test.ts src/app/api/pages/\[pageId\]/acl-invites/route.test.ts`.
- [ ] **Commit:** `feat(pages): page-level email invites (pending invites) for ACL UI (#259)`

---

## B5 — Audit vocabulary: documented `page.permission_*` events + viewer labels

The scope (G6 #265 + #259) wants human-readable, documented audit events `page.permission_granted` / `page.permission_revoked`. The backend currently emits `page_acl.created`/`changed`/`removed`. Add the documented events and a label map, keeping the legacy events as recognized aliases for SIEM back-compat (do not delete them).

**Files:**
- Modify `src/lib/audit/actions.ts` (append new actions + target type).
- Modify `src/components/admin/audit-viewer.tsx` (label-map entries).
- Modify `src/lib/pages/acl.ts` (`setPageAcl` emits `page.permission_granted`/`page.permission_changed`; `removePageAcl` emits `page.permission_revoked`).
- Modify `src/lib/audit/actions.test.ts` (or create if absent) + audit-viewer label test.

**Steps:**
- [ ] **Write failing test** asserting the new actions are in `AUDIT_ACTIONS` and each has a non-identity label in `ACTION_LABEL` (extend the existing audit-viewer/label test; if none, create `src/components/admin/audit-viewer.test.tsx` that imports `AUDIT_ACTIONS` and asserts every action resolves to a label via `actionLabel(a) !== a`).
  ```ts
  for (const a of ['page.permission_granted','page.permission_changed','page.permission_revoked','page.permission_invited','page.permission_invite_revoked','page.ownership_transferred'] as const) {
    expect(AUDIT_ACTIONS).toContain(a);
    expect(actionLabel(a)).not.toBe(a);
  }
  ```
- [ ] **Run to fail:** `source ~/.zshenv && pnpm vitest run src/components/admin/audit-viewer.test.tsx`.
- [ ] **Minimal impl** `src/lib/audit/actions.ts` — append after the `page_acl.*` block (keep the legacy three):
  ```ts
  // v0.9.9 Plan B (#259) — documented per-page permission vocabulary. The legacy
  // page_acl.* events above stay emitted-and-recognized for SIEM back-compat;
  // these are the human-facing names the audit UI labels and new code emits.
  'page.permission_granted',
  'page.permission_changed',
  'page.permission_revoked',
  'page.permission_invited',
  'page.permission_invite_revoked',
  'page.ownership_transferred',
  ```
  and add `| 'page_acl_invite'` to `AuditTargetType`.
- [ ] **Impl** `src/components/admin/audit-viewer.tsx` `ACTION_LABEL` — add:
  ```ts
  'page.permission_granted': 'Page permission granted',
  'page.permission_changed': 'Page permission changed',
  'page.permission_revoked': 'Page permission revoked',
  'page.permission_invited': 'Page invite sent',
  'page.permission_invite_revoked': 'Page invite revoked',
  'page.ownership_transferred': 'Page ownership transferred',
  ```
- [ ] **Impl** `src/lib/pages/acl.ts` — switch `setPageAcl`'s `action` to `existing ? 'page.permission_changed' : 'page.permission_granted'` and `removePageAcl`'s to `'page.permission_revoked'`. Update the existing `src/lib/pages/acl.test.ts` expectations accordingly (and the transfer test from B3 keeps `page.ownership_transferred`).
- [ ] **Run to pass:** `source ~/.zshenv && pnpm vitest run src/lib/pages src/components/admin/audit-viewer.test.tsx`.
- [ ] **Commit:** `feat(audit): documented page.permission_* events + viewer labels (#259, #265)`

---

## B6 — Extend `PageAclManager`: email invite, role select with owner, pending invites, transfer ownership

Now wire the new backend into the existing manager component so the drawer the user opens via B2 actually exposes the four promised affordances. The component already lists current grants + member-search grant; this adds the invite-by-email input, the `owner` role, a pending-invites section, and a transfer-ownership control.

**Files:**
- Modify `src/components/pages/page-acl-manager.tsx`.
- Modify `messages/{en,es,ar}.json` (new `share.acl.*` keys).
- Modify/extend `src/components/pages/page-acl-manager.test.tsx` (create if absent).

**Steps:**
- [ ] Add i18n keys to all three catalogs (next to the existing `share.acl.*` block, en.json ~line 220):

  `messages/en.json`:
  ```json
  "share.acl.permission.owner": "Owner",
  "share.acl.inviteByEmail": "Invite by email",
  "share.acl.invitePlaceholder": "name@example.com",
  "share.acl.invite": "Invite",
  "share.acl.pendingTitle": "Pending invites",
  "share.acl.pendingEmpty": "No pending invites.",
  "share.acl.revokeInvite": "Revoke",
  "share.acl.invited": "Invite sent",
  "share.acl.inviteError": "Could not send invite. Check the address and try again.",
  "share.acl.transfer": "Transfer ownership",
  "share.acl.transferConfirmTitle": "Transfer page ownership?",
  "share.acl.transferConfirmBody": "{name} will become the page owner. You will keep edit access.",
  "share.acl.transferConfirmAction": "Transfer",
  "share.acl.transferConfirmCancel": "Cancel"
  ```
  `messages/es.json`:
  ```json
  "share.acl.permission.owner": "Propietario",
  "share.acl.inviteByEmail": "Invitar por correo",
  "share.acl.invitePlaceholder": "nombre@ejemplo.com",
  "share.acl.invite": "Invitar",
  "share.acl.pendingTitle": "Invitaciones pendientes",
  "share.acl.pendingEmpty": "No hay invitaciones pendientes.",
  "share.acl.revokeInvite": "Revocar",
  "share.acl.invited": "Invitación enviada",
  "share.acl.inviteError": "No se pudo enviar la invitación. Revisa la dirección e inténtalo de nuevo.",
  "share.acl.transfer": "Transferir propiedad",
  "share.acl.transferConfirmTitle": "¿Transferir la propiedad de la página?",
  "share.acl.transferConfirmBody": "{name} pasará a ser el propietario de la página. Tú conservarás el acceso de edición.",
  "share.acl.transferConfirmAction": "Transferir",
  "share.acl.transferConfirmCancel": "Cancelar"
  ```
  `messages/ar.json`:
  ```json
  "share.acl.permission.owner": "المالك",
  "share.acl.inviteByEmail": "الدعوة عبر البريد الإلكتروني",
  "share.acl.invitePlaceholder": "name@example.com",
  "share.acl.invite": "دعوة",
  "share.acl.pendingTitle": "الدعوات المعلقة",
  "share.acl.pendingEmpty": "لا توجد دعوات معلقة.",
  "share.acl.revokeInvite": "إلغاء",
  "share.acl.invited": "تم إرسال الدعوة",
  "share.acl.inviteError": "تعذر إرسال الدعوة. تحقق من العنوان وحاول مرة أخرى.",
  "share.acl.transfer": "نقل الملكية",
  "share.acl.transferConfirmTitle": "نقل ملكية الصفحة؟",
  "share.acl.transferConfirmBody": "سيصبح {name} مالك الصفحة. ستحتفظ بصلاحية التحرير.",
  "share.acl.transferConfirmAction": "نقل",
  "share.acl.transferConfirmCancel": "إلغاء"
  ```
- [ ] **Write failing test** `src/components/pages/page-acl-manager.test.tsx`: mock `fetch` for `/acls` (one `edit` grant), `/acl-invites` (one pending invite), and `/workspaces/members`. Assert: (1) the role `<Select>` now offers an "Owner" option; (2) typing an email + clicking "Invite" POSTs to `/api/pages/${id}/acl-invites` with `{email, permission}`; (3) the "Pending invites" section lists the pending email with a "Revoke" button that DELETEs `/acl-invites`; (4) clicking "Transfer ownership" on a grant opens the themed confirm and on confirm PUTs `{userId, permission:'owner'}` to `/acls`.
  ```tsx
  it('sends an email invite', async () => {
    renderWithProviders(<PageAclManager pageId={PID} />);
    await userEvent.type(screen.getByLabelText(/invite by email/i), 'new@x.io');
    await userEvent.click(screen.getByRole('button', { name: /^invite$/i }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/pages/${PID}/acl-invites`, expect.objectContaining({ method: 'POST' }));
  });
  it('lists and revokes a pending invite', async () => {
    renderWithProviders(<PageAclManager pageId={PID} />);
    expect(await screen.findByText('pending@x.io')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/pages/${PID}/acl-invites`, expect.objectContaining({ method: 'DELETE' }));
  });
  ```
- [ ] **Run to fail:** `source ~/.zshenv && pnpm vitest run src/components/pages/page-acl-manager.test.tsx`.
- [ ] **Minimal impl** `src/components/pages/page-acl-manager.tsx`:
  - Widen `Permission` to `'view' | 'comment' | 'edit' | 'owner'` and add an `<SelectItem value="owner">{t('share.acl.permission.owner')}</SelectItem>`.
  - Add invite state (`inviteEmail`) + an `invite()` that POSTs to `/api/pages/${pageId}/acl-invites` with `{email: inviteEmail, permission}`, sets `t('share.acl.invited')` on ok / `t('share.acl.inviteError')` on failure, clears the field, and reloads invites. Render an `<Input id="acl-invite" aria-label={t('share.acl.inviteByEmail')} type="email" placeholder={t('share.acl.invitePlaceholder')}/>` + Invite button beneath the existing member-search row.
  - Add `invites` state + `reloadInvites()` (GET `/api/pages/${pageId}/acl-invites`, resilient like `reload`), and a "Pending invites" `<ul>` (or `share.acl.pendingEmpty`) with a per-row Revoke button → DELETE `{inviteId}`.
  - Add a "Transfer ownership" outline button on each current grant row (next to Remove) that calls `confirm({title: t('share.acl.transferConfirmTitle'), description: t('share.acl.transferConfirmBody',{name: row.name||row.email}), confirmLabel: t('share.acl.transferConfirmAction'), cancelLabel: t('share.acl.transferConfirmCancel'), variant:'danger'})` then PUTs `{userId: row.userId, permission:'owner'}` to `/acls` and reloads. (Reusing the existing `setPageAcl` upsert via the `'owner'` tier from B3 is intentional — the manager-driven transfer is a simple grant; the dedicated `transferPageOwnership` lib + demotion is exercised by the route/lib path and is available if the controller later adds a one-click transfer endpoint.)
- [ ] **Run to pass:** `source ~/.zshenv && pnpm vitest run src/components/pages/page-acl-manager.test.tsx`.
- [ ] **Commit:** `feat(pages): invite-by-email, owner role, pending invites & transfer in ACL manager (#259)`

---

## B7 — Group gate (HOLD for GO; single PR onto `patches/v0.9.9`)

Full per-group verification. All commands run on GitHub-hosted runners; zero deferral; full vitest (not a subset).

**Steps:**
- [ ] **Lint (0 errors):** `source ~/.zshenv && pnpm lint` — accept Biome auto-fixes (import order, `import type`, line reflow), re-run to confirm 0 errors.
- [ ] **Typecheck:** `source ~/.zshenv && pnpm typecheck` — 0 errors (confirm widened `PageAclPermission` / `EffectivePermission` unions flow through `acl.ts`, `acl-list.ts`, both routes, and the manager component).
- [ ] **i18n none-new:** `source ~/.zshenv && pnpm lint` runs the i18n Biome rule; additionally run the project's i18n-completeness check (the catalog parity test) to confirm every new key exists in **en + es + ar** and there are **no** untranslated/raw user-facing strings introduced. Expected: no new untranslated keys.
- [ ] **Migration applies:** `source ~/.zshenv && pnpm test` boots Testcontainers Postgres and runs `drizzle/migrations/0062_*.sql` from clean — confirm the CHECK constraints + `page_acl_invites` table + partial-unique index create without error, applied after 0061.
- [ ] **FULL test suite:** `source ~/.zshenv && pnpm vitest run` — entire suite green (not just `src/lib/pages`). Confirm no regression in the existing ACL resolver / route / SharePanel tests.
- [ ] **Build:** `source ~/.zshenv && pnpm build` — `next build` + entrypoint tsc clean.
- [ ] **Route-reachability smoke (nav/editor group requirement):** confirm `/api/pages/[pageId]/acls` (GET/PUT/DELETE) and `/api/pages/[pageId]/acl-invites` (GET/POST/DELETE) are registered routes and respond (401/403 unauth, not 404) on the built app; confirm the page ⋯ menu renders the "Share & permissions" entry for an **unpublished** page and opening it mounts `PageAclManager`.
- [ ] **e2e UI-acceptance gate (deployed-image check):** on the deployed `patches/v0.9.9` image, manually walk #259's acceptance: open a private (unpublished) page → ⋯ → **Share & permissions** opens → grant a member `Can comment` → invite an email (appears under **Pending invites**) → revoke the invite → transfer ownership to a member (confirm dialog) → verify the audit log (`/settings/admin/audit`) shows **Page permission granted**, **Page invite sent**, **Page invite revoked**, and **Page ownership transferred** rows with resolved actor/target. Record pass/fail per feature in the PR checklist.
- [ ] **Open the single PR** onto `patches/v0.9.9` titled `Plan B — Per-page ACL UI (#259)` linking all B-commits, with the deployed-image acceptance checklist in the body. **HOLD — do not merge; await user GO.** Do not push from a subagent; the controller/human pushes.

---

**Closes #259.** References #265 (audit Actor/Target readability — the documented `page.permission_*` labels feed that group's resolver work).

# v0.9.9 Plan K — Workspace Onboarding

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Close the onboarding/account gaps from the v0.9.8 live audit (issues #206/#215, #216, #225/#226, #198, #199). New pages must stop persisting a literal "Untitled", autofocus + select the title with an optional template nudge, and default to **Draft** (not Published — security-adjacent). The invite flow gets a self-contained "Invite member" modal with a copy-link affordance after creation. The account profile becomes editable (display name) with an avatar upload that lands in the existing `users.avatar_url` column.

**Architecture:** Pages are created server-side via `createPage` (`src/lib/pages/create.ts`), invoked from the editor `POST /api/pages` route. The "naming step" is purely client-side: `NewPageButton` pushes `?new=1` onto the new page URL, and `PageTitleInput` reads that flag (via `useSearchParams`) to autofocus + select-all on mount and optionally surface a template prompt. New pages currently default to the workspace's `default_page_status` column (`workspaces.default_page_status`, column-default `'published'`); K2 flips that column default to `'draft'` via migration **0064** (the scope's reserved avatar slot is repurposed because `users.avatar_url` already exists, so no new column is needed there). Invites are created by the existing `POST /api/invites` route; `InvitesManager` already renders a copy-link after creation but lives on a full settings page — K3 wraps it in a Radix dialog ("Invite member" modal) and hardens the copy affordance with a real Copy button. Profile editing adds a new `PATCH /api/users/me` route (mirroring the members-PATCH pattern in `src/app/api/workspaces/[id]/members/[userId]/route.ts`) backed by a pure, db-injected `updateUserProfile` helper, plus an avatar upload that reuses the multipart `POST /api/upload` pipeline (`storeUpload` + signed URL) and writes the resulting signed URL to `users.avatar_url`.

**Tech Stack:** Next.js 16 App Router (React 19, TS6, `proxy.ts` auth gate), Drizzle + Postgres (migrations applied at container startup via `src/server/entrypoint.ts`), Auth.js v5 (jwt session — `session.user.id` only), TipTap 3 editor, Tailwind v4 + shadcn/ui (Radix `Dialog`/`Select`), Vitest 4 + Testcontainers v12 (real Postgres), Biome v2, i18n en/es/ar via flat dotted keys in `messages/{en,es,ar}.json` + `useT()` from `src/lib/i18n/provider.tsx`. Shell prefix for every command: `source ~/.zshenv && `.

**Constraints:** GitHub-hosted runners only (no self-hosted). Biome 0 errors. i18n adds keys to ALL THREE locales (en/es/ar). Zero deferral — every checkbox lands in this PR. Full `pnpm vitest run` per gate. New e2e UI-acceptance gate: route-reachability + per-feature deployed-image check. Single PR onto `patches/v0.9.9`, HOLD for GO.

---

## K1 — New-page naming: stop persisting literal "Untitled", autofocus + select, optional template nudge (#206/#215 = #215/#206)

Cause: `src/lib/pages/create.ts:54` inserts `title: input.title ?? 'Untitled'`, so a brand-new page is born with a literal title rather than an empty one — the editor then shows "Untitled" as real text instead of placeholder, and there is no naming step. `NewPageButton` (`src/components/new-page-button.tsx:24`) pushes `/pages/${id}` with no signal that the page is freshly created, and `PageTitleInput` (`src/components/page-title-input.tsx`) never autofocuses or selects. The `pages.title` column is `notNull().default('Untitled')` (schema), so the DB can store `''` only if we explicitly pass it; the placeholder `"Untitled"` on the `<input>` already exists and should be the only place that string lives.

**Files:**
- Modify: `src/lib/pages/create.ts` (store empty title when caller omits it)
- Modify: `src/app/api/pages/route.ts` (relax `title` min so `''`/omitted is accepted; keep max)
- Modify: `src/components/new-page-button.tsx` (push `?new=1`)
- Modify: `src/components/page-title-input.tsx` (autofocus + select on `?new=1`; optional template nudge)
- Modify: `tests/lib/pages/create.test.ts` (empty-title assertion)
- Create: `tests/components/page-title-input-new.test.tsx` (autofocus/select + nudge)
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`

Steps:

- [ ] Write failing test in `tests/lib/pages/create.test.ts`: add `it('stores an empty title when none is provided (no literal Untitled)', async () => { const u = await createTestWorkspaceWithUser(db); const page = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId }); expect(page.title).toBe(''); });` and update the existing `'creates a top-level page with default title and empty content'` assertion from `expect(page.title).toBe('Untitled')` to `expect(page.title).toBe('')`.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/pages/create.test.ts` (expect the empty-title assertions to fail — still inserts `'Untitled'`).
- [ ] Minimal impl in `src/lib/pages/create.ts`: change line 54 from `title: input.title ?? 'Untitled',` to `title: input.title ?? '',`. Update the comment block above the insert to note "v0.9.9 K1 #215/#206 — a brand-new page is born title-less; the editor shows the localized placeholder, never a literal 'Untitled'."
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/pages/create.test.ts`.
- [ ] Relax the API contract so omitted/empty title is accepted: in `src/app/api/pages/route.ts` change `title: z.string().min(1).max(200).optional(),` to `title: z.string().max(200).optional(),` (empty string remains valid; `createPage` already coerces `undefined → ''`).
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/api/pages-create.test.ts`.
- [ ] Commit: `git commit -am "fix(pages): store empty title for new pages instead of literal Untitled (#215)"`
- [ ] Add i18n keys (the title placeholder + the optional naming nudge). Insert into `messages/en.json`:
  ```json
  "page.title.placeholder": "Untitled",
  "page.title.nudge": "Give your page a name to get started.",
  "page.title.startBlank": "Start blank",
  "page.title.fromTemplate": "Use a template"
  ```
  `messages/es.json`:
  ```json
  "page.title.placeholder": "Sin título",
  "page.title.nudge": "Ponle un nombre a tu página para empezar.",
  "page.title.startBlank": "Empezar en blanco",
  "page.title.fromTemplate": "Usar una plantilla"
  ```
  `messages/ar.json`:
  ```json
  "page.title.placeholder": "بدون عنوان",
  "page.title.nudge": "أعطِ صفحتك اسمًا للبدء.",
  "page.title.startBlank": "ابدأ من فارغ",
  "page.title.fromTemplate": "استخدم قالبًا"
  ```
- [ ] Write failing component test `tests/components/page-title-input-new.test.tsx` that renders `<PageTitleInput>` inside an `I18nProvider` (locale `en`, messages loaded from `messages/en.json`) and a mocked router/searchParams where `useSearchParams` returns `new URLSearchParams('new=1')`. Assert: (a) the input is focused (`document.activeElement === input`); (b) `input.selectionStart === 0 && input.selectionEnd === input.value.length`; (c) the localized nudge text "Give your page a name to get started." is rendered; (d) a "Use a template" link with `href="/templates/gallery"` is present. Mock `next/navigation` `useSearchParams`/`useRouter` like the existing `tests/components/search-palette-escape.test.tsx` does.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/page-title-input-new.test.tsx`.
- [ ] Minimal impl in `src/components/page-title-input.tsx`: import `useSearchParams` from `next/navigation`, `useEffect`/`useRef`, `useT` from `@/lib/i18n/provider`, and `Link`/`Route`. Add a ref to the `<input>`; in a `useEffect` keyed on mount, read `useSearchParams().get('new') === '1'`; when true call `ref.current?.focus()` then `ref.current?.select()`. Replace the hardcoded `placeholder="Untitled"` with `placeholder={t('page.title.placeholder')}`. When `isNew` and `value.trim() === ''`, render below the input a muted nudge row:
  ```tsx
  {isNew && value.trim() === '' ? (
    <p className="mt-1 text-sm text-muted-foreground">
      {t('page.title.nudge')}{' '}
      <Link href={'/templates/gallery' as Route} className="underline underline-offset-2">
        {t('page.title.fromTemplate')}
      </Link>
    </p>
  ) : null}
  ```
  Wrap the input + nudge in a `<div>`. Keep the existing empty-string guard in `save()` so a blank title is never PATCHed (the page legitimately stays title-less until the user types).
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/page-title-input-new.test.tsx`.
- [ ] Modify `src/components/new-page-button.tsx`: change `router.push(\`/pages/${created.id}\` as Route)` to `router.push(\`/pages/${created.id}?new=1\` as Route)` so the destination page autofocuses + selects the title. Leave the `router.refresh()` call.
- [ ] Run to pass (component-level smoke): `source ~/.zshenv && pnpm vitest run tests/components`.
- [ ] Commit: `git commit -am "feat(pages): autofocus+select new-page title with template nudge (#215 #206)"`

---

## K2 — New pages default Draft, not Published (#216 = #37/#216; security-adjacent)

Cause: `createPage` reads `workspaces.default_page_status` (`src/db/schema/workspaces.ts:34`) which has column default `'published'`, and `pages.status` also defaults to `'published'` (`src/db/schema/pages.ts:98`). Migration 0047 (v0.9.0 G4 P26) introduced lifecycle status and forward-declared the workspace default, but chose `'published'` so the change was a no-op for fresh installs. The audit flags this as security-adjacent: a brand-new page silently becomes world-/workspace-visible (publishable) before the author has reviewed it. Fix: flip the workspace column default to `'draft'` so freshly created workspaces default new pages to Draft; existing workspaces are left untouched (admins may have intentionally set a default), and the `pages.status` column default is left as-is because `createPage` always overrides it with the workspace value.

**Files:**
- Create: `drizzle/migrations/0064_default_page_status_draft.sql`
- Modify: `src/db/schema/workspaces.ts` (column default → `'draft'`)
- Create: `tests/lib/pages/create-default-status.test.ts`
- Modify: `drizzle/migrations/meta/_journal.json` (auto-updated by `db:generate`; verify entry)

Steps:

- [ ] Write failing test `tests/lib/pages/create-default-status.test.ts`: spin up Testcontainers Postgres + `runMigrations`, `createTestWorkspaceWithUser`, then `const page = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });` and assert `expect(page.status).toBe('draft');`. Add a second case proving an admin override still wins: `await db.update(schema.workspaces).set({ defaultPageStatus: 'published' }).where(eq(schema.workspaces.id, u.workspaceId)); const p2 = await createPage(...); expect(p2.status).toBe('published');`.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/pages/create-default-status.test.ts` (expect `'published'` from the fresh workspace — fails).
- [ ] Update the schema default in `src/db/schema/workspaces.ts:34`: change `defaultPageStatus: text('default_page_status').notNull().default('published'),` to `defaultPageStatus: text('default_page_status').notNull().default('draft'),`. Update the inline comment in `src/lib/pages/create.ts` line 38-41 to note "v0.9.9 K2 #216 — the workspace default is now 'draft' (security-adjacent: new pages are not auto-published); admins can still set the default to 'published'."
- [ ] Generate the migration: `source ~/.zshenv && pnpm db:generate` and confirm it emits `drizzle/migrations/0064_*.sql`. Rename/move the SQL to `drizzle/migrations/0064_default_page_status_draft.sql` (and the corresponding `_journal.json` tag) if the generator names it otherwise. Hand-verify the file body is exactly the `ALTER COLUMN ... SET DEFAULT` (no destructive backfill):
  ```sql
  -- 0064_default_page_status_draft.sql
  -- v0.9.9 K2 #216 — new pages should be born as drafts, not published
  -- (security-adjacent: prevents accidental publish-before-review). Only the
  -- COLUMN DEFAULT changes; existing workspaces keep whatever default an admin
  -- already chose, and existing pages.status values are untouched.
  ALTER TABLE "workspaces" ALTER COLUMN "default_page_status" SET DEFAULT 'draft';
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/pages/create-default-status.test.ts` (the `runMigrations` call applies 0064 against the fresh container).
- [ ] Run the existing status suite to confirm no regression: `source ~/.zshenv && pnpm vitest run tests/lib/pages/status.test.ts tests/lib/pages/publish-status.test.ts tests/api/pages-status.test.ts`.
- [ ] Commit: `git commit -am "fix(pages): default new pages to Draft not Published (#216)\n\nmigration 0064 flips workspaces.default_page_status column default to\n'draft'. createPage already honors the workspace value, so existing\nworkspaces and pages are untouched; only freshly created workspaces\nchange behavior."`

---

## K3 — Invite-member modal + copy-link after creation (#225/#226 = #225/#226)

Cause: The "Invite member" entry routes to a full settings page rather than a modal, and the trigger label does not match the destination (#225). The `InvitesManager` (`src/app/(app)/settings/workspace/invites/invites-manager.tsx`) already builds and shows the invite URL after creation (lines 44, 66-67, 155-160), but it renders the URL inside a bare `<code>` with no Copy button (#226). Fix: extract the form into a reusable body, wrap it in a Radix `Dialog` triggered by an "Invite member" button (label matches), and add a real Copy button (reuse the existing `CopyButton` from `src/components/settings/copy-button.tsx`) next to the created link. The pending-invites table stays on the page; the modal hosts only the create-form + copy-link.

**Files:**
- Create: `src/app/(app)/settings/workspace/invites/invite-member-dialog.tsx`
- Modify: `src/app/(app)/settings/workspace/invites/invites-manager.tsx` (extract create-form body; add Copy button; mount dialog trigger)
- Create: `tests/components/invite-member-dialog.test.tsx`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`

Steps:

- [ ] Add i18n keys. `messages/en.json`:
  ```json
  "invites.inviteMember": "Invite member",
  "invites.dialogTitle": "Invite a member",
  "invites.dialogDescription": "Create an invite link and share it with the person you want to add.",
  "invites.copyLink": "Copy invite link",
  "invites.linkCreated": "Invite link created — share it with the invitee:",
  "invites.close": "Close"
  ```
  `messages/es.json`:
  ```json
  "invites.inviteMember": "Invitar miembro",
  "invites.dialogTitle": "Invitar a un miembro",
  "invites.dialogDescription": "Crea un enlace de invitación y compártelo con la persona que quieras añadir.",
  "invites.copyLink": "Copiar enlace de invitación",
  "invites.linkCreated": "Enlace de invitación creado: compártelo con la persona invitada:",
  "invites.close": "Cerrar"
  ```
  `messages/ar.json`:
  ```json
  "invites.inviteMember": "دعوة عضو",
  "invites.dialogTitle": "دعوة عضو",
  "invites.dialogDescription": "أنشئ رابط دعوة وشاركه مع الشخص الذي تريد إضافته.",
  "invites.copyLink": "نسخ رابط الدعوة",
  "invites.linkCreated": "تم إنشاء رابط الدعوة — شاركه مع المدعو:",
  "invites.close": "إغلاق"
  ```
- [ ] Write failing test `tests/components/invite-member-dialog.test.tsx`: render `<InviteMemberDialog workspaceId="ws-1" />` inside `I18nProvider` (en). Assert the trigger button has accessible name "Invite member". Mock `next/navigation` (`useRouter().refresh`) and `global.fetch` to resolve `{ ok: true, json: async () => ({ token: 'tok-123' }) }`. Click the trigger → assert dialog title "Invite a member" appears. Fill the email input, submit the form, then assert: (a) the localized "Invite link created" copy renders; (b) an element containing the URL `…/invite/tok-123` is present; (c) a button with accessible name "Copy invite link" is present. Use `@testing-library/react` + `userEvent` as the existing `tests/components/*.test.tsx` do.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/invite-member-dialog.test.tsx` (component does not exist yet).
- [ ] Refactor `invites-manager.tsx`: extract the create-`<form>` + the `createdLink` block into an exported `InviteCreateForm` component (props: `{ workspaceId: string }`) that owns the `email`/`role`/`days`/`submitting`/`error`/`createdLink` state and the `createInvite` handler. Replace the bare `<code>{createdLink}</code>` block with the localized `invites.linkCreated` heading + a row that pairs the URL with `<CopyButton value={createdLink} label={t('invites.copyLink')} />` (import `CopyButton` from `@/components/settings/copy-button`, `useT` from `@/lib/i18n/provider`). `InvitesManager` keeps the pending-invites table and now renders `<InviteCreateForm workspaceId={workspaceId} />` above it (preserving existing on-page behavior) OR the modal trigger — see next step.
- [ ] Create `src/app/(app)/settings/workspace/invites/invite-member-dialog.tsx` (`'use client'`): a Radix `Dialog` (shadcn `@/components/ui/dialog`: `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`). `DialogTrigger` is a `Button` labelled `t('invites.inviteMember')`. `DialogContent` renders `<DialogTitle>{t('invites.dialogTitle')}</DialogTitle>`, `<DialogDescription>{t('invites.dialogDescription')}</DialogDescription>`, then `<InviteCreateForm workspaceId={workspaceId} />`. Keep the dialog open after creation so the admin can copy the link; closing resets via Radix unmount.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/invite-member-dialog.test.tsx`.
- [ ] Mount the dialog on the invites settings page: in `src/app/(app)/settings/workspace/invites/page.tsx`, render `<InviteMemberDialog workspaceId={workspaceId} />` in the page header next to the heading (so the "Invite member" affordance opens the modal). Keep `<InvitesManager>` for the pending-invites table; if `InvitesManager` previously hosted the create form inline, have it now render only the table (the dialog is the single create entry point) — verify the existing `tests/api/admin-invites.test.ts` route behavior is unaffected (no API change).
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/invite-member-dialog.test.tsx tests/api/admin-invites.test.ts tests/api/invites.test.ts`.
- [ ] Commit: `git commit -am "feat(invites): invite-member modal with copy-link after creation (#225 #226)"`

---

## K4 — Profile display-name editable (#198 = #19/#198)

Cause: `src/app/(app)/settings/account/profile/page.tsx` renders the display name read-only inside a `<dl>` (lines 36-39); there is no client form and no route to mutate `users.name`. The JWT session carries only the user id, so the page already reads `users` directly — we extend that with an editable client form posting to a new `PATCH /api/users/me`. Business logic lives in a pure, db-injected `updateUserProfile` helper so it is unit-testable without HTTP, matching the project convention.

**Files:**
- Create: `src/lib/users/profile.ts` (pure `updateUserProfile` helper)
- Create: `src/app/api/users/me/route.ts` (`PATCH`)
- Create: `src/components/account/profile-form.tsx` (`'use client'` display-name form)
- Modify: `src/app/(app)/settings/account/profile/page.tsx` (mount the form)
- Create: `tests/lib/users/profile.test.ts`
- Create: `tests/api/users-me.test.ts`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`

Steps:

- [ ] Write failing test `tests/lib/users/profile.test.ts`: Testcontainers + `runMigrations`; insert a user; call `await updateUserProfile(db, { userId, name: 'New Name' })` and assert the row's `name` is `'New Name'`. Add a guard case: `await expect(updateUserProfile(db, { userId, name: '   ' })).rejects.toThrow(/name/i)` (reject blank/whitespace), and `await expect(updateUserProfile(db, { userId, name: 'x'.repeat(201) })).rejects.toThrow(/name/i)` (max length 200).
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/users/profile.test.ts`.
- [ ] Minimal impl `src/lib/users/profile.ts`:
  ```ts
  import { eq } from 'drizzle-orm';
  import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
  import * as schema from '@/db/schema';

  export type UpdateUserProfileInput = {
    userId: string;
    name?: string;
    avatarUrl?: string | null;
  };

  export async function updateUserProfile(
    db: PostgresJsDatabase<typeof schema>,
    input: UpdateUserProfileInput,
  ): Promise<schema.User> {
    const patch: Partial<schema.NewUser> = {};
    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (trimmed.length === 0 || trimmed.length > 200) {
        throw new Error('name must be 1–200 characters');
      }
      patch.name = trimmed;
    }
    if (input.avatarUrl !== undefined) patch.avatarUrl = input.avatarUrl;
    if (Object.keys(patch).length === 0) throw new Error('no fields to update');
    const [user] = await db
      .update(schema.users)
      .set(patch)
      .where(eq(schema.users.id, input.userId))
      .returning();
    if (!user) throw new Error('user not found');
    return user;
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/users/profile.test.ts`.
- [ ] Write failing test `tests/api/users-me.test.ts`: mirror `tests/api/invites.test.ts` setup (`vi.mock('@/lib/auth/config')` exposing `__setSession`). Set a session for a real user, `PATCH` the route with `{ name: 'Renamed' }`, assert `200` and the returned `{ name: 'Renamed' }`; assert the DB row was updated. Add: unauthenticated → `401`; blank name → `400`.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/api/users-me.test.ts`.
- [ ] Minimal impl `src/app/api/users/me/route.ts`:
  ```ts
  import { NextResponse } from 'next/server';
  import { z } from 'zod';
  import { getDb } from '@/db/client';
  import { HttpError, requireRole } from '@/lib/auth/require-role';
  import { updateUserProfile } from '@/lib/users/profile';

  const PatchBody = z.object({
    name: z.string().min(1).max(200).optional(),
    avatarUrl: z.string().url().nullable().optional(),
  });

  export async function PATCH(req: Request): Promise<Response> {
    try {
      const ctx = await requireRole('viewer'); // any signed-in member may edit their own profile
      const body = PatchBody.parse(await req.json().catch(() => ({})));
      const user = await updateUserProfile(getDb(), { userId: ctx.userId, ...body });
      return NextResponse.json({ id: user.id, name: user.name, avatarUrl: user.avatarUrl });
    } catch (err) {
      if (err instanceof HttpError)
        return NextResponse.json({ error: err.message }, { status: err.status });
      if (err instanceof z.ZodError)
        return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
      const message = err instanceof Error ? err.message : 'unknown';
      if (/name|no fields/i.test(message))
        return NextResponse.json({ error: message }, { status: 400 });
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
  ```
  (If `requireRole('viewer')` throws `401` when no session exists, the unauthenticated case is covered; confirm against `src/lib/auth/require-role.ts` — it throws `HttpError(401)` when `getAuthContext()` is null.)
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/api/users-me.test.ts`.
- [ ] Commit: `git commit -am "feat(account): editable display name via PATCH /api/users/me (#198)"`
- [ ] Add i18n keys. `messages/en.json`:
  ```json
  "profile.displayName": "Display name",
  "profile.save": "Save",
  "profile.saving": "Saving…",
  "profile.saved": "Profile updated",
  "profile.saveError": "Could not update your profile"
  ```
  `messages/es.json`:
  ```json
  "profile.displayName": "Nombre para mostrar",
  "profile.save": "Guardar",
  "profile.saving": "Guardando…",
  "profile.saved": "Perfil actualizado",
  "profile.saveError": "No se pudo actualizar tu perfil"
  ```
  `messages/ar.json`:
  ```json
  "profile.displayName": "الاسم المعروض",
  "profile.save": "حفظ",
  "profile.saving": "جارٍ الحفظ…",
  "profile.saved": "تم تحديث الملف الشخصي",
  "profile.saveError": "تعذّر تحديث ملفك الشخصي"
  ```
- [ ] Write failing test `tests/components/profile-form.test.tsx`: render `<ProfileForm initialName="Old Name" />` in `I18nProvider` (en). Mock `next/navigation` `useRouter().refresh` and `global.fetch` to resolve `{ ok: true, json: async () => ({ name: 'New Name' }) }`. Assert the input is seeded with "Old Name"; type a new value; submit; assert `fetch` was called with `'/api/users/me'`, `method: 'PATCH'`, and a JSON body containing `name`; assert the localized "Profile updated" success copy appears.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/profile-form.test.tsx`.
- [ ] Minimal impl `src/components/account/profile-form.tsx` (`'use client'`): a controlled `<form>` with a `useId`-labelled display-name `<input>` seeded from `initialName`, a submit `Button` (label `profile.save`/`profile.saving`), and an inline success/error region. On submit, `fetch('/api/users/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })`; on `ok`, set the localized `profile.saved` message and call `router.refresh()`; on error, show `profile.saveError`. Use `useT()` for all strings.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/profile-form.test.tsx`.
- [ ] Mount in `src/app/(app)/settings/account/profile/page.tsx`: replace the read-only "Display name" `<dt>/<dd>` pair with `<ProfileForm initialName={user?.name ?? ''} />` (keep Email + User ID rows as-is). Import `ProfileForm` from `@/components/account/profile-form`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/profile-form.test.tsx`.
- [ ] Commit: `git commit -am "feat(account): profile display-name edit form (#198)"`

---

## K5 — Avatar upload via /api/files + user avatar column (#199 = #20/#199)

Cause: The profile page has no avatar affordance (#199); the audit reserved migration 0064 for a `users.avatar_url` column, but that column **already exists** (`src/db/schema/users.ts:8`, `avatar_url text`) and is currently unused anywhere in the app (`rg avatar_url` → schema only). So **no migration is needed** — K5 wires the existing column end-to-end: a client avatar uploader that POSTs the image to the existing multipart `POST /api/upload` pipeline (`storeUpload` → `{ file, signedUrl }`), then PATCHes the resulting `signedUrl` to `users.avatar_url` via the K4 `PATCH /api/users/me` route, and renders the current avatar (with initials fallback) on the profile page.

**Files:**
- Create: `src/components/account/avatar-uploader.tsx` (`'use client'`)
- Modify: `src/app/(app)/settings/account/profile/page.tsx` (read `avatarUrl`; render avatar + uploader)
- Modify: `tests/api/users-me.test.ts` (avatarUrl PATCH case — the helper already supports it)
- Create: `tests/components/avatar-uploader.test.tsx`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`
- (No migration — `users.avatar_url` already exists; the scope's reserved 0064 slot is repurposed by K2.)

Steps:

- [ ] Extend `tests/api/users-me.test.ts` with an avatar case: `PATCH` `{ avatarUrl: 'https://example.com/api/files/abc?sig=x&exp=1' }`, assert `200` and the row's `avatar_url` is persisted; assert `{ avatarUrl: null }` clears it.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/api/users-me.test.ts` (the K4 helper + route already accept `avatarUrl`; if the route's Zod `z.string().url()` rejects the relative `/api/files/...` form, confirm `storeUpload` returns an absolute signed URL — it does via `signFileUrl` using `PUBLIC_URL`; otherwise relax to allow a leading `/`).
- [ ] Add i18n keys. `messages/en.json`:
  ```json
  "profile.avatar": "Avatar",
  "profile.avatarUpload": "Upload avatar",
  "profile.avatarUploading": "Uploading…",
  "profile.avatarRemove": "Remove avatar",
  "profile.avatarError": "Could not upload that image",
  "profile.avatarHint": "PNG, JPG, GIF or WebP, up to the workspace upload limit."
  ```
  `messages/es.json`:
  ```json
  "profile.avatar": "Avatar",
  "profile.avatarUpload": "Subir avatar",
  "profile.avatarUploading": "Subiendo…",
  "profile.avatarRemove": "Quitar avatar",
  "profile.avatarError": "No se pudo subir esa imagen",
  "profile.avatarHint": "PNG, JPG, GIF o WebP, hasta el límite de subida del espacio de trabajo."
  ```
  `messages/ar.json`:
  ```json
  "profile.avatar": "الصورة الرمزية",
  "profile.avatarUpload": "رفع صورة رمزية",
  "profile.avatarUploading": "جارٍ الرفع…",
  "profile.avatarRemove": "إزالة الصورة الرمزية",
  "profile.avatarError": "تعذّر رفع تلك الصورة",
  "profile.avatarHint": "PNG أو JPG أو GIF أو WebP، حتى حد الرفع لمساحة العمل."
  ```
- [ ] Write failing test `tests/components/avatar-uploader.test.tsx`: render `<AvatarUploader initialAvatarUrl={null} fallbackName="Jon Cohen" />` in `I18nProvider` (en). Assert the initials fallback "JC" is shown and an "Upload avatar" control exists. Mock `global.fetch` so the FIRST call (`/api/upload`) resolves `{ ok: true, json: async () => ({ signedUrl: 'https://host/api/files/abc?sig=x&exp=1' }) }` and the SECOND (`/api/users/me`) resolves `{ ok: true, json: async () => ({ avatarUrl: 'https://host/api/files/abc?sig=x&exp=1' }) }`. Fire a `change` event on the hidden file `<input type="file">` with a fake `image/png` `File`; assert: (a) `/api/upload` was called with `method: 'POST'` and a `FormData` body whose `file` field is the File; (b) `/api/users/me` was then PATCHed with `{ avatarUrl: 'https://host/api/files/abc?sig=x&exp=1' }`; (c) the `<img>` now has that `src`.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/avatar-uploader.test.tsx`.
- [ ] Minimal impl `src/components/account/avatar-uploader.tsx` (`'use client'`):
  - Render an avatar: if `avatarUrl` set, an `<img src={avatarUrl} alt="">` (rounded, 64px); else an initials circle derived from `fallbackName` (first letters of first two words, uppercased).
  - A hidden `<input type="file" accept="image/png,image/jpeg,image/gif,image/webp">` triggered by an "Upload avatar" `Button` (`profile.avatarUpload`/`profile.avatarUploading`).
  - On file change: build `FormData`, append `file`; `const up = await fetch('/api/upload', { method: 'POST', body: form });` → on `ok`, read `{ signedUrl }`; then `await fetch('/api/users/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ avatarUrl: signedUrl }) })`; on `ok` set local `avatarUrl` state and call `router.refresh()`. On any failure, show `profile.avatarError`.
  - A "Remove avatar" `Button` (shown only when an avatar is set) that PATCHes `{ avatarUrl: null }`.
  - Render the `profile.avatarHint` muted helper text. All strings via `useT()`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/avatar-uploader.test.tsx`.
- [ ] Mount in `src/app/(app)/settings/account/profile/page.tsx`: extend the `users` select to include `avatarUrl: schema.users.avatarUrl`, and render `<AvatarUploader initialAvatarUrl={user?.avatarUrl ?? null} fallbackName={user?.name ?? user?.email ?? 'User'} />` above the `ProfileForm`. Import `AvatarUploader` from `@/components/account/avatar-uploader`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/avatar-uploader.test.tsx`.
- [ ] Commit: `git commit -am "feat(account): avatar upload wired to existing users.avatar_url column (#199)"`

---

## K-Gate — Plan K verification gate (BLOCKING; single PR onto patches/v0.9.9, HOLD for GO)

Run every command below from the repo root with the `source ~/.zshenv && ` prefix. Every check must pass with zero deferral before the PR is opened. GitHub-hosted runners only.

- [ ] Lint, 0 errors: `source ~/.zshenv && pnpm lint` (accept Biome auto-fixes via `pnpm biome check --write` if it reorders imports / narrows `import type`, then re-run `pnpm lint` to confirm clean).
- [ ] Typecheck: `source ~/.zshenv && pnpm typecheck` (0 errors; verify the `Route` casts on the new `?new=1` push and the `/templates/gallery` link).
- [ ] i18n none-new: confirm the i18n Biome rule / key-parity check passes — every key added in K1/K3/K4/K5 exists in ALL THREE of `messages/en.json`, `messages/es.json`, `messages/ar.json` with no orphan keys: `source ~/.zshenv && pnpm vitest run tests/unit/i18n-parity.test.ts` (or the project's i18n parity test); the "none-new untranslated" gate must report zero missing keys across locales.
- [ ] FULL test suite (NOT a subset): `source ~/.zshenv && pnpm vitest run` — entire suite green (Testcontainers Postgres required; `colima start` first if the daemon is down). Migration 0064 must apply cleanly inside `runMigrations` for every db-backed file.
- [ ] Build: `source ~/.zshenv && pnpm build` (Next 16 standalone build + entrypoint tsc; 0 errors).
- [ ] e2e UI-acceptance gate — route reachability (Playwright smoke against the built app): assert `200`/reachable for `/settings/workspace/invites` (invite-member modal trigger), `/settings/account/profile` (display-name form + avatar uploader), and a freshly created page route `/pages/{id}?new=1`. The new-page route must render the title input focused with the localized placeholder, not a literal "Untitled".
- [ ] e2e UI-acceptance gate — per-feature deployed-image checklist (run against the deployed `ghcr.io/jonathanmcohen/cairn` v0.9.9 image, not just local dev): (1) Click "New page" → URL carries `?new=1`, title input is focused + selected, no literal "Untitled" persisted, template nudge visible while blank. (2) New page's lifecycle status reads **Draft** (not Published). (3) "Invite member" opens a modal whose label matches; creating an invite shows the URL with a working Copy button. (4) Profile display name edits and persists after reload. (5) Avatar upload renders the new image and survives reload; "Remove avatar" clears it.
- [ ] Open a SINGLE PR onto `patches/v0.9.9` (do NOT merge): branch off `patches/v0.9.9`, push the Plan K commits, open the PR with body linking #206/#215, #216, #225/#226, #198, #199 and the migration-0064 note. **HOLD for user GO** before merge — the controller/human merges; subagents do not push to or merge into `patches/v0.9.9`.

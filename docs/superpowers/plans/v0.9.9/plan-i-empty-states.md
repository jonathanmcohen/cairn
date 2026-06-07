# Cairn v0.9.9 — Plan I: Empty States, Nav Entries & Notification Matrix

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Close the G9/G3/G6 "bare surface" findings from the v0.9.8 live audit. Give every dead-end surface a recognizable icon + a one-action CTA (Trash, Flashcards-due, /favorites, the bell flyout, API-key quotas), wire the two missing main-sidebar destinations (`/favorites`, `/inbox`), give the SMTP-disabled notification banner an actionable CTA link, expand the notification event matrix from two emailable types (mention, comment_reply) to five by adding `page_approval`, `page_status`, and `page_lock` notification types with their emitters + prefs matrix (migration 0062), and expand the webhook event matrix from CRUD-only (6 events) to the full audited catalog with a Select-all / Recommended helper.

**Architecture:** All UI strings flow through the two existing string registries: the i18n catalog (`messages/{en,es,ar}.json` + `useT()` from `@/lib/i18n/provider`) for client components, and the English-only `copy()` registry (`src/lib/copy/messages.ts`) consumed by the shared `EmptyState`/`variants.tsx` server-renderable components. The shared empty-state primitive is `src/components/empty-state/empty-state.tsx` (`EmptyState` accepts `icon`, `headline`, `guidance`, `ctaLabel`, `ctaHref`|`onCta`). Notification types are stored as free-text in `notifications.type` (no PG enum — the column is `text`), and the emailable subset is the typed tuple `NOTIFICATION_TYPES` in `src/lib/email/prefs.ts` (the compile-time source of truth that drives both the prefs API zod enum and the prefs UI label map). Notification emitters live in `src/lib/notifications/create.ts` and are invoked from `src/lib/pages/{approval,status,lock}.ts`. Webhook events are a frozen tuple `EVENTS` in `src/components/settings/webhooks-manager.tsx`. Migrations are hand-written SQL applied at container start by `src/server/entrypoint.ts`; `db:generate` does not emit triggers/extensions/back-fills, so any non-table DDL is appended by hand.

**Tech Stack:** Next.js 16 App Router (React 19, TS6 strict, Turbopack), Drizzle ORM + Postgres 16, Biome v2 (0-error gate), Vitest 4 + Testcontainers v12 (real Postgres), TipTap 3, Tailwind v4 + shadcn/ui (new-york), i18n en/es/ar via `useT()` / `copy()`. pnpm only. Prefix every shell command with `source ~/.zshenv &&`.

---

## I1 — Icons + CTAs on bare empty states (#42/#43 = #221/#222, favorites icon #25/#204)

**Cause:** The shared `EmptyState` supports an `icon` prop and `ctaLabel`+`ctaHref`/`onCta`, but five surfaces render bare text or omit the icon/CTA: Trash (`trash/page.tsx` raw `<h1>`/`<p>`, no empty-state component when the list is empty), the Flashcards-due screen (`flashcards/study/page.tsx` "No cards due" raw markup, no icon/CTA), the `/favorites` empty branch (`FavoritesList` renders a bare `<p>`, the `EmptyFavorites` variant has no `icon`), the bell flyout (`drawer.tsx` renders a bare `"You're all caught up."` paragraph while the full `/notifications` page-list already shows a `BellOff` icon + heading), and the API-key quotas surface (covered in I6).

**Files:**
- Modify `src/lib/copy/messages.ts` (add `empty.trash.*`, `empty.flashcardsDue.*` keys; add CTAs to favorites/notifications)
- Modify `src/components/empty-state/variants.tsx` (`EmptyFavorites` gains a `Star` icon; new `EmptyTrash`, `EmptyFlashcardsDue` variants)
- Modify `src/components/trash-list.tsx` (render `EmptyTrash` when empty)
- Modify `src/app/(app)/flashcards/study/page.tsx` ("No cards due" → `EmptyFlashcardsDue`)
- Modify `src/components/favorites/favorites-list.tsx` (empty branch → `EmptyFavorites` with icon)
- Modify `src/components/notifications/drawer.tsx` (bare `<p>` → `BellOff` icon + heading + guidance matching page-list)
- Create `tests/components/empty-state/empty-state-icons.test.tsx`
- Modify `tests/components/notifications-drawer.test.tsx` (assert flyout empty state has icon + heading)

### Steps

- [ ] **Failing test — variants render their icon + CTA.** Create `tests/components/empty-state/empty-state-icons.test.tsx`. Render `<EmptyFavorites />`, `<EmptyTrash />`, `<EmptyFlashcardsDue />`. Assert each renders an SVG (the `lucide-react` icon, queried via `container.querySelector('svg')`) and the expected headline text. For `EmptyFavorites` assert `getByText('No favorites yet')`; for `EmptyTrash` assert `getByText('Trash is empty')`; for `EmptyFlashcardsDue` assert `getByRole('link', { name: 'Browse pages' })` resolves to `href="/"`.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/empty-state/empty-state-icons.test.tsx` — fails (`EmptyTrash`/`EmptyFlashcardsDue` undefined, `EmptyFavorites` has no icon).
- [ ] **Add copy keys.** In `src/lib/copy/messages.ts`, inside the `MESSAGES` object after the existing `empty.recents.*` block, add:
  ```ts
    'empty.trash.headline': 'Trash is empty',
    'empty.trash.guidance':
      'Deleted pages land here for 30 days, then are permanently removed. Nothing has been deleted recently.',

    'empty.flashcardsDue.headline': 'No cards due',
    'empty.flashcardsDue.guidance':
      'You are caught up on reviews. Add a flashcard to any page with the /flashcard slash command.',
    'empty.flashcardsDue.cta': 'Browse pages',

    'empty.favorites.cta': 'Browse pages',
  ```
- [ ] **Add icons + new variants.** In `src/components/empty-state/variants.tsx`, import icons: `import { BellOff, GraduationCap, Star, Trash2 } from 'lucide-react';`. Give `EmptyFavorites` an `icon={<Star aria-hidden="true" />}` and a `ctaLabel={copy('empty.favorites.cta')}` + `ctaHref="/"`. Add `EmptyNotifications` an `icon={<BellOff aria-hidden="true" />}`. Add:
  ```tsx
  export function EmptyTrash() {
    return (
      <EmptyState
        icon={<Trash2 aria-hidden="true" />}
        headline={copy('empty.trash.headline')}
        guidance={copy('empty.trash.guidance')}
      />
    );
  }

  export function EmptyFlashcardsDue() {
    return (
      <EmptyState
        icon={<GraduationCap aria-hidden="true" />}
        headline={copy('empty.flashcardsDue.headline')}
        guidance={copy('empty.flashcardsDue.guidance')}
        ctaLabel={copy('empty.flashcardsDue.cta')}
        ctaHref="/"
      />
    );
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/empty-state/empty-state-icons.test.tsx`.
- [ ] **Wire Trash.** In `src/components/trash-list.tsx`, import `EmptyTrash` from `@/components/empty-state/variants`; when the live item list is empty render `<EmptyTrash />` instead of the empty `<ul>`. (Keep `trash/page.tsx`'s `<h1>Trash</h1>` + retention `<p>` — they're page chrome, not the empty state.)
- [ ] **Wire Flashcards-due.** In `src/app/(app)/flashcards/study/page.tsx`, replace the `queue.length === 0` block's raw `<h1>`/`<p>` with `<div className="mx-auto max-w-xl p-8"><EmptyFlashcardsDue /></div>` and add the import. (`EmptyFlashcardsDue` reads from `copy()` which is English-only and works in a client component — no `useT()` needed; the surface is dev-facing study mode.)
- [ ] **Wire Favorites.** In `src/components/favorites/favorites-list.tsx`, replace the `items.length === 0` bare `<p>` branch with `<EmptyFavorites />` (import from variants). This drops the `favorites.page.empty` i18n key usage in the empty branch; keep `FavoritesHeader` untouched.
- [ ] **Wire bell flyout.** In `src/components/notifications/drawer.tsx`, add `BellOff` to the `lucide-react` import. Replace the `items.length === 0 ? (<p ...>You're all caught up.</p>)` ternary branch with:
  ```tsx
  ) : items.length === 0 ? (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <BellOff aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
      <p className="font-medium text-sm">You&rsquo;re all caught up</p>
      <p className="text-muted-foreground text-xs">
        New mentions, replies, and approvals will show up here.
      </p>
    </div>
  ) : (
  ```
- [ ] **Extend drawer test.** In `tests/components/notifications-drawer.test.tsx`, add a case: render the drawer open with an empty feed (mock `/api/notifications?limit=50` → `{ notifications: [], unreadCount: 0 }`), `await` the SWR resolve, then assert `container.querySelector('svg')` is present and `getByText("You're all caught up")` resolves. (The page-list `notifications-page-list.test.tsx` already covers the `BellOff` icon on the full page — mirror its assertion.)
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/notifications-drawer.test.tsx tests/components/empty-state`.
- [ ] **Commit:** `feat(empty-states): add icons + CTAs to trash, flashcards, favorites, and bell-flyout empty states (#221 #222 #204)`

---

## I2 — `/favorites` + `/inbox` main-sidebar entries (#23/#202)

**Cause:** `src/components/sidebar-footer-nav.tsx` lists My-tasks → Templates → Settings → Trash but never `/favorites` or `/inbox`. Both routes exist (`src/app/(app)/favorites/page.tsx`, `src/app/(app)/inbox/page.tsx`) and are reachable only via the ⌘K palette / `Mod+Shift+F` shortcut. The scope (#202) wants a `Star` `<Link href="/favorites">` placed before "My tasks". We add `/inbox` (`Inbox` icon) in the same group for parity. The nav items are currently hard-coded English strings — promote them to i18n keys while editing.

**Files:**
- Modify `src/components/sidebar-footer-nav.tsx` (add Favorites + Inbox links; i18n the labels)
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json` (`sidebar.nav.*` keys)
- Create `tests/components/sidebar-footer-nav.test.tsx`

### Steps

- [ ] **Failing test.** Create `tests/components/sidebar-footer-nav.test.tsx`. Render `<SidebarFooterNav version="0.9.9" />` wrapped in an `I18nProvider` with `getMessages('en')`. Assert `getByRole('link', { name: 'Favorites' })` has `href="/favorites"`, `getByRole('link', { name: 'Inbox' })` has `href="/inbox"`, and that the Favorites link appears **before** the "My tasks" link in DOM order (compare `compareDocumentPosition` or index in `getAllByRole('link')`).
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-footer-nav.test.tsx`.
- [ ] **Add i18n keys.** Append to each catalog. `messages/en.json`:
  ```json
  "sidebar.nav.favorites": "Favorites",
  "sidebar.nav.inbox": "Inbox",
  "sidebar.nav.myTasks": "My tasks",
  "sidebar.nav.templates": "Templates",
  "sidebar.nav.settings": "Settings",
  "sidebar.nav.trash": "Trash"
  ```
  `messages/es.json`:
  ```json
  "sidebar.nav.favorites": "Favoritos",
  "sidebar.nav.inbox": "Bandeja de entrada",
  "sidebar.nav.myTasks": "Mis tareas",
  "sidebar.nav.templates": "Plantillas",
  "sidebar.nav.settings": "Ajustes",
  "sidebar.nav.trash": "Papelera"
  ```
  `messages/ar.json`:
  ```json
  "sidebar.nav.favorites": "المفضلة",
  "sidebar.nav.inbox": "صندوق الوارد",
  "sidebar.nav.myTasks": "مهامي",
  "sidebar.nav.templates": "القوالب",
  "sidebar.nav.settings": "الإعدادات",
  "sidebar.nav.trash": "المحذوفات"
  ```
- [ ] **Implement.** In `src/components/sidebar-footer-nav.tsx`, add `Inbox, Star` to the `lucide-react` import. Insert before the My-tasks `<Link>`:
  ```tsx
      <Link href="/favorites" className={NAV_ITEM_CLASS}>
        <Star aria-hidden="true" className="h-4 w-4" />
        {t('sidebar.nav.favorites')}
      </Link>
      <Link href="/inbox" className={NAV_ITEM_CLASS}>
        <Inbox aria-hidden="true" className="h-4 w-4" />
        {t('sidebar.nav.inbox')}
      </Link>
  ```
  Replace the hard-coded `My tasks` / `Templates` / `Settings` / `Trash` text nodes with `{t('sidebar.nav.myTasks')}` etc.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-footer-nav.test.tsx`.
- [ ] **i18n-completeness guard.** Run `source ~/.zshenv && pnpm vitest run tests/i18n` (the existing catalog-parity suite) to confirm the three catalogs stay key-aligned with no new untranslated keys.
- [ ] **Commit:** `feat(sidebar): add Favorites and Inbox main-nav entries with i18n labels (#202)`

---

## I3 — SMTP-disabled notification banner CTA link (#15/#194)

**Cause:** `src/components/settings/notification-prefs.tsx` renders the `!smtpEnabled` banner (`notifications.smtp.disabledBanner`) as plain text with no action — an operator reading it has no link to where SMTP is configured. The scope (#194) wants an admin SMTP / docs CTA. The repo already has a documented `e2ee.docsLink`-style pattern (a trailing link inside the disabled banner). SMTP is configured via env (`CAIRN_SMTP_*`) so there is no in-app settings form; the correct CTA is a link to the operations/admin docs. Mirror the `e2ee.disabledBody` + docs-link pattern.

**Files:**
- Modify `src/components/settings/notification-prefs.tsx` (append a docs CTA link inside the banner)
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json` (`notifications.smtp.docsLink` key)
- Modify `tests/components/notification-prefs.test.tsx` (assert the link renders only when SMTP disabled, with the right href)

### Steps

- [ ] **Failing test.** In `tests/components/notification-prefs.test.tsx`, add a case: mock `GET /api/notifications/prefs` → `{ prefs: [...], emailEnabled: false }`; render `<NotificationPrefs />` in an `I18nProvider`; `await` the banner; assert `getByRole('link', { name: 'Configure email delivery' })` has `href="https://github.com/jonathanmcohen/cairn/blob/main/docs/operations.md#email-smtp"` and `target="_blank"`. Add a negative case: when `emailEnabled: true`, `queryByRole('link', { name: 'Configure email delivery' })` is `null`.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/notification-prefs.test.tsx`.
- [ ] **Add i18n key.** Append to each catalog. `messages/en.json`: `"notifications.smtp.docsLink": "Configure email delivery"`. `messages/es.json`: `"notifications.smtp.docsLink": "Configurar el envío de correo"`. `messages/ar.json`: `"notifications.smtp.docsLink": "إعداد تسليم البريد الإلكتروني"`.
- [ ] **Implement.** In `src/components/settings/notification-prefs.tsx`, inside the `!smtpEnabled` banner `<div id={bannerId} ...>`, after the existing `{t('notifications.smtp.disabledBanner')}` text, append:
  ```tsx
            {' '}
            <a
              href="https://github.com/jonathanmcohen/cairn/blob/main/docs/operations.md#email-smtp"
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-100"
            >
              {t('notifications.smtp.docsLink')}
            </a>
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/notification-prefs.test.tsx`.
- [ ] **Commit:** `feat(notifications): link SMTP-disabled banner to the email-delivery docs (#194)`

---

## I4 — Notification event-matrix expansion: approval/status/lock types (#16/#195)

**Cause:** The notification matrix only exposes `mention` + `comment_reply` (`NOTIFICATION_TYPES` in `src/lib/email/prefs.ts`). Approvals, lifecycle status changes, and locks already write **audit** rows (`src/lib/pages/{approval,status,lock}.ts`) but never create **notifications**, so the people who care (the editor who requested approval, page collaborators) get nothing in their bell/inbox and have no pref control. We add three emailable types — `page_approval`, `page_status`, `page_lock` — to the `NOTIFICATION_TYPES` tuple (which forces the prefs UI label map + the prefs API zod enum to grow via the compile-time `Record<NotificationType, …>` exhaustiveness), add typed payloads + emitters in `src/lib/notifications/create.ts`, call them from the three lib modules, and seed the per-type prefs matrix for all existing workspace members (migration **0062**). The `notifications.type` column is free-text `text` (no PG enum to alter), but `notification_email_prefs` rows are seeded so the prefs UI shows the new rows immediately.

**Files:**
- Create `drizzle/migrations/0062_notification_event_matrix.sql`
- Modify `drizzle/migrations/meta/_journal.json` (append idx 62)
- Modify `src/db/schema/notifications.ts` (add `NotificationType` members + payload types)
- Modify `src/lib/email/prefs.ts` (extend `NOTIFICATION_TYPES`)
- Modify `src/components/settings/notification-prefs.tsx` (extend `TYPE_LABEL_KEYS`)
- Modify `src/lib/notifications/create.ts` (add `notifyApprovalDecision`, `notifyStatusChange`, `notifyPageLock`)
- Modify `src/lib/pages/approval.ts`, `src/lib/pages/status.ts`, `src/lib/pages/lock.ts` (call emitters)
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json` (3 new `notifications.type.*` keys)
- Create `tests/db/notification-event-matrix.test.ts`
- Create `tests/lib/notify-approval-status-lock.test.ts`

### Steps

- [ ] **Failing migration test.** Create `tests/db/notification-event-matrix.test.ts` using the Testcontainers Postgres helper (`tests/helpers/db.ts`). Apply all migrations, insert a workspace + a member user, then assert: (a) inserting a `notifications` row with `type = 'page_approval'` succeeds (column is `text`, no constraint violation); (b) after running migration 0062, `SELECT count(*) FROM notification_email_prefs WHERE notification_type IN ('page_approval','page_status','page_lock') AND user_id = <member>` returns 3 (seeded, opt-in defaults `email_enabled = false`). Use the project's migration runner (`runMigrations`) so 0062 is exercised end-to-end.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/db/notification-event-matrix.test.ts`.
- [ ] **Write migration 0062.** Create `drizzle/migrations/0062_notification_event_matrix.sql`. `notifications.type` is `text` (no enum), so the only DDL-adjacent work is the back-fill seed of `notification_email_prefs` for the three new types across every existing `workspace_members` row, idempotently:
  ```sql
  -- 0062 — notification event-matrix expansion (#195).
  -- notifications.type is free-text; no enum to ALTER. We only seed the new
  -- emailable per-type prefs rows for every existing workspace member, opt-in
  -- (email_enabled / digest_only default false), idempotent via ON CONFLICT
  -- against the (user_id, workspace_id, notification_type) primary key.
  INSERT INTO notification_email_prefs (user_id, workspace_id, notification_type, email_enabled, digest_only)
  SELECT wm.user_id, wm.workspace_id, t.notification_type, false, false
  FROM workspace_members wm
  CROSS JOIN (VALUES ('page_approval'), ('page_status'), ('page_lock')) AS t(notification_type)
  ON CONFLICT (user_id, workspace_id, notification_type) DO NOTHING;
  ```
  Append the journal entry to `drizzle/migrations/meta/_journal.json` (`idx: 62`, `version: "7"`, `when:` next-timestamp, `tag: "0062_notification_event_matrix"`, `breakpoints: true`).
- [ ] **Extend schema types.** In `src/db/schema/notifications.ts`, extend the `NotificationType` union with `| 'page_approval' | 'page_status' | 'page_lock'`, update the `// 'mention' | …` comment on the `type` column, and add payload types:
  ```ts
  export type PageApprovalNotificationPayload = {
    pageId: string;
    actorId: string;
    decision: 'approved' | 'rejected' | 'requested_changes';
  };
  export type PageStatusNotificationPayload = {
    pageId: string;
    actorId: string;
    status: string;
  };
  export type PageLockNotificationPayload = {
    pageId: string;
    actorId: string;
    locked: boolean;
  };
  ```
  Add the three to the `NotificationPayload` union.
- [ ] **Extend the emailable tuple.** In `src/lib/email/prefs.ts`, change `NOTIFICATION_TYPES` to `['mention', 'comment_reply', 'page_approval', 'page_status', 'page_lock'] as const;` and update the `#72`-decision comment to note these three DO consult the per-type pref (they route through `scheduleEmails` → `sendNotificationEmail` → `getEmailPref`).
- [ ] **Extend the prefs label map (forces compile-time exhaustiveness).** In `src/components/settings/notification-prefs.tsx`, extend `TYPE_LABEL_KEYS`:
  ```ts
  const TYPE_LABEL_KEYS: Record<NotificationType, string> = {
    mention: 'notifications.type.mention',
    comment_reply: 'notifications.type.commentReply',
    page_approval: 'notifications.type.pageApproval',
    page_status: 'notifications.type.pageStatus',
    page_lock: 'notifications.type.pageLock',
  };
  ```
- [ ] **Add i18n keys.** Append to each catalog. `messages/en.json`:
  ```json
  "notifications.type.pageApproval": "Approval decisions",
  "notifications.type.pageStatus": "Page status changes",
  "notifications.type.pageLock": "Page locks"
  ```
  `messages/es.json`:
  ```json
  "notifications.type.pageApproval": "Decisiones de aprobación",
  "notifications.type.pageStatus": "Cambios de estado de la página",
  "notifications.type.pageLock": "Bloqueos de página"
  ```
  `messages/ar.json`:
  ```json
  "notifications.type.pageApproval": "قرارات الموافقة",
  "notifications.type.pageStatus": "تغييرات حالة الصفحة",
  "notifications.type.pageLock": "أقفال الصفحة"
  ```
- [ ] **Failing emitter test.** Create `tests/lib/notify-approval-status-lock.test.ts` (Testcontainers). Seed a workspace + a page + the page's prior version author (a distinct user from the actor). Call `notifyApprovalDecision(db, {pageId, actorId, workspaceId, decision: 'approved', recipientIds: [author]})`; assert one `notifications` row with `type = 'page_approval'`, `payload.decision = 'approved'`, `userId = author`, and that the actor is excluded. Repeat for `notifyStatusChange` (`type = 'page_status'`, `payload.status`) and `notifyPageLock` (`type = 'page_lock'`, `payload.locked = true`).
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/notify-approval-status-lock.test.ts`.
- [ ] **Implement emitters.** In `src/lib/notifications/create.ts`, add three functions following the existing `notifyMentions` shape (dedupe recipients, exclude the actor, `.returning()`, `incNotificationsSent({ channel: 'in_app' })` per row, then `scheduleEmails(rows)`):
  ```ts
  export async function notifyApprovalDecision(
    db: Db,
    input: {
      actorId: string;
      pageId: string;
      workspaceId: string;
      decision: 'approved' | 'rejected' | 'requested_changes';
      recipientIds: string[];
    },
  ): Promise<schema.Notification[]> {
    const targets = [...new Set(input.recipientIds)].filter((id) => id !== input.actorId);
    if (targets.length === 0) return [];
    const rows = await db
      .insert(schema.notifications)
      .values(
        targets.map((userId) => ({
          userId,
          workspaceId: input.workspaceId,
          type: 'page_approval' as const,
          payload: { pageId: input.pageId, actorId: input.actorId, decision: input.decision },
        })),
      )
      .returning();
    for (const _row of rows) incNotificationsSent({ channel: 'in_app' });
    scheduleEmails(rows);
    return rows;
  }
  ```
  Add `notifyStatusChange` (`type: 'page_status'`, payload `{pageId, actorId, status}`) and `notifyPageLock` (`type: 'page_lock'`, payload `{pageId, actorId, locked}`) with the same body shape.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/notify-approval-status-lock.test.ts`.
- [ ] **Wire approval emitter.** In `src/lib/pages/approval.ts#decide`, after the transaction commits, resolve the recipient set (the page's prior approval-requesters / version authors excluding the approver — query `page_versions.createdBy` distinct for the page) and call `await notifyApprovalDecision(getDb(), { actorId: input.approverUserId, pageId: input.pageId, workspaceId: input.workspaceId, decision: input.decision, recipientIds })`. Fire it post-commit with a fresh `getDb()` connection (mirrors the `scheduleEmails`/webhook post-commit rule — never the tx). Swallow rejections so notification failure can't roll back a signed approval.
- [ ] **Wire status emitter.** In `src/lib/pages/status.ts#transitionStatus`, after the status flip commits, call `notifyStatusChange(getDb(), { actorId: input.byUserId, pageId: input.pageId, workspaceId, status: input.to, recipientIds })` where `recipientIds` is the page's collaborators (favoriters / prior version authors) excluding the actor. (If `workspaceId` isn't already in scope here, derive it from the page row already loaded in `transitionStatus`.)
- [ ] **Wire lock emitter.** In `src/lib/pages/lock.ts#lockPage` and `#unlockPage`, after the tx commits call `notifyPageLock(getDb(), { actorId: input.byUserId, pageId: input.pageId, workspaceId: input.workspaceId, locked: true|false, recipientIds })` (recipients = page collaborators minus the actor).
- [ ] **Update prefs-UI test.** Extend `tests/components/notification-prefs.test.tsx` to assert all five type rows render (mention, comment_reply, page_approval, page_status, page_lock) with their localized labels when `GET /api/notifications/prefs` returns five prefs.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/db/notification-event-matrix.test.ts tests/lib/notify-approval-status-lock.test.ts tests/components/notification-prefs.test.tsx tests/api/notification-prefs.test.ts`.
- [ ] **Commit:** `feat(notifications): add approval, status, and lock notification types + emitters + prefs matrix (migration 0062) (#195)`

---

## I5 — Webhook event-matrix expansion + Select-all (#78/#79 = #257/#258)

**Cause:** `EVENTS` in `src/components/settings/webhooks-manager.tsx` is CRUD-only (`page.created/updated/deleted`, `row.created/updated/deleted`) — 6 of the audited event types. Operators can't subscribe to comment, member, approval, lock, or status events even though those are emitted in the audit layer. There is also no Select-all / Recommended bulk-select, so subscribing to many events means six-plus individual clicks. The scope (#257) wants the full audited catalog; (#258) wants bulk-select helpers. We expand the tuple, group the checkbox list by namespace, and add "Select all" + "Recommended" buttons.

**Files:**
- Modify `src/components/settings/webhooks-manager.tsx` (expand `EVENTS`, add grouping + Select-all/Recommended + Clear)
- Create `tests/components/webhooks-manager-events.test.tsx`

### Steps

- [ ] **Failing test.** Create `tests/components/webhooks-manager-events.test.tsx`. Render `<WebhooksManager initialHooks={[]} initialDeliveries={[]} />`, click "Add webhook" to open the create form. Assert: (a) every expanded event renders a checkbox (query by the event label text — e.g. `getByText('comment.created')`, `getByText('member.invited')`, `getByText('page.approved')`, `getByText('page.locked')`, `getByText('page.status_changed')`); (b) clicking the "Select all" button checks all checkboxes (`getAllByRole('checkbox').every(c => c.checked)`); (c) clicking "Recommended" checks exactly the recommended subset; (d) clicking "Clear" unchecks all.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/webhooks-manager-events.test.tsx`.
- [ ] **Expand the event catalog + groups.** In `src/components/settings/webhooks-manager.tsx`, replace the `EVENTS` tuple with a grouped, recommended-aware structure (keep a flat `EVENTS` derived from it so existing references still type-check):
  ```ts
  const EVENT_GROUPS = [
    { label: 'Pages', events: ['page.created', 'page.updated', 'page.deleted'] },
    { label: 'Rows', events: ['row.created', 'row.updated', 'row.deleted'] },
    { label: 'Comments', events: ['comment.created', 'comment.resolved'] },
    { label: 'Lifecycle', events: ['page.status_changed', 'page.approved', 'page.approval_rejected', 'page.changes_requested'] },
    { label: 'Locks', events: ['page.locked', 'page.unlocked'] },
    { label: 'Members', events: ['member.invited', 'member.joined', 'member.removed'] },
  ] as const;
  const EVENTS = EVENT_GROUPS.flatMap((g) => g.events);
  const RECOMMENDED_EVENTS = [
    'page.created',
    'page.updated',
    'page.deleted',
    'page.approved',
  ] as const;
  ```
- [ ] **Render grouped checkboxes + bulk controls.** Replace the single `<fieldset>` body: render one labeled sub-group per `EVENT_GROUPS` entry (group label as a small `<span className="text-xs font-medium text-muted-foreground">`), and add a control row above the groups:
  ```tsx
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedEvents([...EVENTS])}>
                    Select all
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedEvents([...RECOMMENDED_EVENTS])}>
                    Recommended
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedEvents([])}>
                    Clear
                  </Button>
                </div>
  ```
  Keep the per-event `toggleEvent` checkbox markup, iterating `group.events` inside each group.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/webhooks-manager-events.test.tsx`.
- [ ] **Verify the create-payload still posts an array.** The existing `onCreate` already posts `events: selectedEvents`; confirm the existing `tests/components/*webhook*`/`tests/api/webhooks*` suites still pass with the larger catalog (no server-side allowlist rejects the new event strings — `events` is a `text[]` column with no CHECK constraint).
- [ ] **Commit:** `feat(webhooks): expand event catalog to full audited set with grouped Select-all/Recommended (#257 #258)`

---

## I6 — API-key quotas empty state → "Mint a token" CTA (#24/#203)

**Cause:** `src/components/settings/api-keys-manager.tsx` renders a bare `<p>No API keys yet.</p>` when `keys.length === 0` — no icon, no path to creating one. The scope (#203) wants a CTA pointing the operator at the personal-tokens surface. The canonical token-minting destination in this codebase is `/settings/developer/tokens` (the `api-keys` page itself documents "Mint tokens under Settings → Developer → Personal tokens"). We replace the bare paragraph with a `KeyRound`-iconed empty state and a "Mint a token" CTA link. `ApiKeysManager` is a client component (`'use client'`) and consumes `useT()` already used across settings, so we use i18n keys.

**Files:**
- Modify `src/components/settings/api-keys-manager.tsx` (replace bare empty `<p>` with iconed empty state + CTA)
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json` (`apiKeys.empty.*` keys)
- Create `tests/components/api-keys-empty.test.tsx`

### Steps

- [ ] **Failing test.** Create `tests/components/api-keys-empty.test.tsx`. Render `<ApiKeysManager initialKeys={[]} />` inside an `I18nProvider` (`getMessages('en')`). Assert: `getByText('No API keys yet')` (heading), a rendered `svg` (the `KeyRound` icon via `container.querySelector('svg')`), and `getByRole('link', { name: 'Mint a token' })` with `href="/settings/developer/tokens"`. Add a non-empty case: with one key in `initialKeys`, `queryByRole('link', { name: 'Mint a token' })` is `null` (the empty state only shows when there are no keys).
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/api-keys-empty.test.tsx`.
- [ ] **Add i18n keys.** Append to each catalog. `messages/en.json`:
  ```json
  "apiKeys.empty.headline": "No API keys yet",
  "apiKeys.empty.guidance": "Personal access tokens authenticate the HTTP API and MCP clients. Mint one to get started.",
  "apiKeys.empty.cta": "Mint a token"
  ```
  `messages/es.json`:
  ```json
  "apiKeys.empty.headline": "Aún no hay claves de API",
  "apiKeys.empty.guidance": "Los tokens de acceso personal autentican la API HTTP y los clientes MCP. Crea uno para empezar.",
  "apiKeys.empty.cta": "Crear un token"
  ```
  `messages/ar.json`:
  ```json
  "apiKeys.empty.headline": "لا توجد مفاتيح API بعد",
  "apiKeys.empty.guidance": "تُصادق رموز الوصول الشخصية على واجهة HTTP وعملاء MCP. أنشئ رمزًا للبدء.",
  "apiKeys.empty.cta": "إنشاء رمز"
  ```
- [ ] **Implement.** In `src/components/settings/api-keys-manager.tsx`, import `EmptyState` from `@/components/empty-state/empty-state`, `KeyRound` from `lucide-react`, and `useT` from `@/lib/i18n/provider` (if not already present). Replace `<p className="text-muted-foreground">No API keys yet.</p>` with:
  ```tsx
            <EmptyState
              icon={<KeyRound aria-hidden="true" />}
              headline={t('apiKeys.empty.headline')}
              guidance={t('apiKeys.empty.guidance')}
              ctaLabel={t('apiKeys.empty.cta')}
              ctaHref="/settings/developer/tokens"
            />
  ```
  (`EmptyState` already renders `ctaHref` as a Next `<Link>` wrapping a `<Button>` — no extra wiring.)
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/api-keys-empty.test.tsx`.
- [ ] **Commit:** `feat(api-keys): iconed empty state with Mint-a-token CTA (#203)`

---

## I7 — Group I gate (HOLD for GO)

Single PR onto `patches/v0.9.9`. Do **not** merge — open the PR and HOLD for the user's GO.

### Steps

- [ ] **Lint — 0 errors:** `source ~/.zshenv && pnpm lint` (Biome v2; accept its import-ordering / `import type` auto-fixes via `biome check --write`, then re-run to confirm 0 errors).
- [ ] **Typecheck:** `source ~/.zshenv && pnpm typecheck` — must pass. The `Record<NotificationType, string>` label map and the `z.enum(NOTIFICATION_TYPES)` prefs body are the compile-time guards proving I4's type expansion reached every consumer.
- [ ] **i18n completeness — no untranslated new keys:** `source ~/.zshenv && pnpm vitest run tests/i18n` — confirms `messages/{en,es,ar}.json` stay key-aligned (every new `sidebar.nav.*`, `notifications.smtp.docsLink`, `notifications.type.page*`, `apiKeys.empty.*` key exists in all three locales with a non-empty value, none left English-only).
- [ ] **FULL test suite:** `source ~/.zshenv && pnpm vitest run` (Testcontainers Postgres required — `colima start` first if the daemon is down; isolation stays ON per the repo gotcha). Migration 0062 must apply cleanly inside the full run.
- [ ] **Build:** `source ~/.zshenv && pnpm build` (Next 16 `next build` + entrypoint `tsc`).
- [ ] **Route-reachability smoke (nav group):** Playwright smoke confirming `/favorites` and `/inbox` are reachable from the main sidebar (click the new `SidebarFooterNav` links → assert the route renders its heading), and that `/trash` / `/flashcards/study` / `/settings/developer/api-keys` render their new iconed empty states when their backing lists are empty. This is part of the v0.9.9 **e2e UI-acceptance gate** (route-reachability + per-feature deployed-image check) — run against the built/deployed image on a GitHub-hosted runner (no self-hosted).
- [ ] **Per-feature deployed-image checklist (manual, on the deployed image):** Favorites + Inbox visible in the sidebar; Trash / Flashcards-due / Favorites / bell-flyout / API-key-quotas empty states each show an icon + (where applicable) a working CTA; SMTP-disabled banner shows the docs link only when SMTP is off; notification prefs lists all five type rows; webhook create form shows the full grouped event catalog with working Select-all / Recommended / Clear.
- [ ] **Open the PR onto `patches/v0.9.9`** with a body summarizing I1–I6 and the migration 0062 note. **HOLD — do not merge; await user GO.**

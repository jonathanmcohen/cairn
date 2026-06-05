# v0.9.9 Plan T — Comments

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Close the comment-editing gap surfaced in the v0.9.8 live audit (#74/#255) by giving authors an inline edit affordance on their own comments backed by a `PATCH /api/comments/:id` body-update path, and — as an explicit stretch/optional item — add Notion-style emoji reactions on comments (net-new schema + API + UI, beyond the audit findings).

**Architecture:** Comments are workspace-scoped rows in `comments` (`src/db/schema/comments.ts`), served read-only to the client by `GET /api/pages/:pageId/comments` and mutated through `PATCH`/`DELETE /api/comments/:commentId` (`src/app/api/comments/[commentId]/route.ts`). Business logic lives in pure, db-injected helpers under `src/lib/comments/*` (`create.ts`, `resolve.ts`, `delete.ts`, `list.ts`) so it is unit-testable without HTTP. The panel UI is the client component `src/components/comments/comment-panel.tsx`, which holds comments in local React state and reconciles after each mutation. T1 extends the existing PATCH route (today it only toggles `resolved`) with a `body` branch + a new `editComment` helper, and adds an inline editor row in the panel. T2 introduces a brand-new `comment_reactions` table (migration 0062), a per-comment toggle endpoint, and an aggregated reaction bar rendered under each comment body. All new user-facing strings flow through `useT()` against `messages/{en,es,ar}.json` (flat dotted keys).

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript 6 strict · Drizzle ORM + Postgres 16 · Auth.js v5 (jwt) · Biome v2 (0 errors) · Vitest 4 + Testcontainers v12 (real Postgres, `isolate: true`, serial forks) · TipTap 3 · Tailwind v4 + shadcn/ui (new-york) · i18n en/es/ar via `useT()`. GitHub-hosted runners only. Migrations hand-append extensions/triggers/FKs; latest applied is **0061**; this plan owns **0062** (T2 only).

---

## T1 — Edit affordance on own comments (#74/#255)

**Cause (from scope/audit):** `comment-panel.tsx` renders each comment body read-only (`<p>{comment.body}</p>`, line 189) with only Resolve/Reopen/Delete controls; there is no edit path. The PATCH route (`src/app/api/comments/[commentId]/route.ts`) accepts `{ resolved: boolean }` exclusively (`PatchInput`, line 10), so even a body change has no server seam. Authors who typo a comment must delete + re-add.

**Fix:** Add a pure `editComment(db, { commentId, workspaceId, actorId, actorRole, body })` helper (author-only, mirrors `deleteComment`'s author/admin guard but **edit is author-only** — admins can delete but not silently rewrite another user's words), widen `PatchInput` to a discriminated body/resolved union, and add an inline edit mode in the panel gated on `comment.authorId === currentUserId`.

**Files:**
- Create `src/lib/comments/edit.ts`
- Create `tests/lib/comments/edit.test.ts`
- Modify `src/app/api/comments/[commentId]/route.ts`
- Modify `tests/api/comments-item-routes.test.ts`
- Modify `src/components/comments/comment-panel.tsx`
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json`

### Steps

- [ ] Write failing helper test `tests/lib/comments/edit.test.ts` — header copies the Testcontainers boilerplate from `tests/lib/comments/delete.test.ts` (`startPostgres`/`runMigrations`/`TRUNCATE comments, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`). Cases:
  - author edits own comment → returns row with new `body`, `updatedAt` advanced past `createdAt`;
  - non-author **editor** attempts edit → throws `HttpError` 403 with message `Only the author can edit this comment`;
  - non-author **admin** attempts edit → also 403 (edit is strictly author-only, unlike delete);
  - empty/whitespace body → throws `Error('comment body is required')`;
  - cross-workspace `commentId` → `HttpError` 404 `Comment not found` (no existence leak).
  ```ts
  it('lets the author edit their own comment', async () => {
    const { workspaceId, userId } = await createTestWorkspaceWithUser();
    const page = await createPage(getDb(), { workspaceId, authorId: userId, title: 'P' });
    const { comment } = await createComment(getDb(), {
      workspaceId, authorId: userId, body: 'taht', target: { type: 'page', id: page.id },
    });
    const updated = await editComment(getDb(), {
      commentId: comment.id, workspaceId, actorId: userId, actorRole: 'editor', body: 'that',
    });
    expect(updated.body).toBe('that');
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(updated.createdAt.getTime());
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/comments/edit.test.ts` (fails: module `src/lib/comments/edit.ts` does not exist).
- [ ] Minimal impl `src/lib/comments/edit.ts`:
  ```ts
  import { and, eq } from 'drizzle-orm';
  import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
  import * as schema from '@/db/schema';
  import { HttpError, type MemberRole } from '@/lib/auth/require-role';

  export type EditCommentInput = {
    commentId: string;
    workspaceId: string;
    actorId: string;
    actorRole: MemberRole;
    body: string;
  };

  export async function editComment(
    db: PostgresJsDatabase<typeof schema>,
    input: EditCommentInput,
  ): Promise<schema.Comment> {
    const body = input.body.trim();
    if (!body) throw new Error('comment body is required');

    const [existing] = await db
      .select({ id: schema.comments.id, authorId: schema.comments.authorId })
      .from(schema.comments)
      .where(
        and(
          eq(schema.comments.id, input.commentId),
          eq(schema.comments.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    // Same status as not-found to avoid leaking comment existence across workspaces.
    if (!existing) throw new HttpError(404, 'Comment not found');
    // Edit is author-only on purpose: admins may delete a comment but must not
    // silently rewrite another member's words (audit #74/#255).
    if (existing.authorId !== input.actorId) {
      throw new HttpError(403, 'Only the author can edit this comment');
    }

    const [updated] = await db
      .update(schema.comments)
      .set({ body, updatedAt: new Date() })
      .where(
        and(
          eq(schema.comments.id, input.commentId),
          eq(schema.comments.workspaceId, input.workspaceId),
        ),
      )
      .returning();
    if (!updated) throw new HttpError(404, 'Comment not found');
    return updated;
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/comments/edit.test.ts`.
- [ ] Commit: `feat(comments): add author-only editComment helper`
- [ ] Write failing route test in `tests/api/comments-item-routes.test.ts` — add a `describe('PATCH body edit')` block reusing the file's `setActor`/`call` helpers:
  - author `PATCH { body: 'fixed' }` → 200, response `body === 'fixed'`;
  - non-author editor `PATCH { body: 'x' }` → 403;
  - `PATCH { body: '' }` → 400 (zod min(1));
  - existing `PATCH { resolved: true }` path still 200 (regression guard, requires `editor`).
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/api/comments-item-routes.test.ts` (fails: route ignores `body`, returns resolve-shaped result / zod rejects unknown branch).
- [ ] Minimal impl — widen `PatchInput` to a union and branch in PATCH. Edit requires `editor` (matches the existing resolve gate) plus the helper's author check:
  ```ts
  const PatchInput = z.union([
    z.object({ resolved: z.boolean() }),
    z.object({ body: z.string().min(1).max(10_000) }),
  ]);

  export async function PATCH(req: Request, { params }: RouteCtx): Promise<Response> {
    try {
      const { commentId } = await params;
      const ctx = await requireRole('editor');
      const parsed = PatchInput.parse(await req.json());
      if ('body' in parsed) {
        const updated = await editComment(getDb(), {
          commentId,
          workspaceId: ctx.workspaceId,
          actorId: ctx.userId,
          actorRole: ctx.role,
          body: parsed.body,
        });
        return NextResponse.json(updated);
      }
      const scope = { commentId, workspaceId: ctx.workspaceId };
      const updated = parsed.resolved
        ? await resolveComment(getDb(), scope)
        : await reopenComment(getDb(), scope);
      return NextResponse.json(updated);
    } catch (err) {
      return errorToResponse(err);
    }
  }
  ```
  Add `import { editComment } from '@/lib/comments/edit';`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/api/comments-item-routes.test.ts`.
- [ ] Commit: `feat(comments): support body edits on the PATCH comment route`
- [ ] Add i18n keys (flat dotted, alongside the existing `pageActions.comments.*` keys) to all three catalogs. Insert into `messages/en.json`:
  ```json
  "pageActions.comments.edit": "Edit",
  "pageActions.comments.editSave": "Save",
  "pageActions.comments.editCancel": "Cancel",
  "pageActions.comments.editSaving": "Saving…",
  "pageActions.comments.editError": "Failed to save edit",
  "pageActions.comments.edited": "edited"
  ```
  `messages/es.json`:
  ```json
  "pageActions.comments.edit": "Editar",
  "pageActions.comments.editSave": "Guardar",
  "pageActions.comments.editCancel": "Cancelar",
  "pageActions.comments.editSaving": "Guardando…",
  "pageActions.comments.editError": "No se pudo guardar la edición",
  "pageActions.comments.edited": "editado"
  ```
  `messages/ar.json`:
  ```json
  "pageActions.comments.edit": "تعديل",
  "pageActions.comments.editSave": "حفظ",
  "pageActions.comments.editCancel": "إلغاء",
  "pageActions.comments.editSaving": "جارٍ الحفظ…",
  "pageActions.comments.editError": "تعذّر حفظ التعديل",
  "pageActions.comments.edited": "مُعدَّل"
  ```
- [ ] Commit: `feat(i18n): add comment-edit strings (en/es/ar)`
- [ ] Wire the inline edit affordance into `src/components/comments/comment-panel.tsx`. Add `Pencil` to the lucide import, add per-row edit state, an `editComment` reconciler, an `edited` marker (when `updatedAt > createdAt`), and the inline editor. Add state at the top of `CommentPanel`:
  ```tsx
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  ```
  Add the mutation alongside `setResolved`:
  ```tsx
  async function saveEdit(comment: Comment) {
    const body = editDraft.trim();
    if (!body || body === comment.body) {
      setEditingId(null);
      return;
    }
    setEditSaving(true);
    setError(null);
    const res = await fetch(`/api/comments/${comment.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    setEditSaving(false);
    if (!res.ok) {
      setError(t('pageActions.comments.editError'));
      return;
    }
    const updated = (await res.json()) as Comment;
    setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setEditingId(null);
  }
  ```
  In `renderRow`, compute `const canEdit = comment.authorId === currentUserId;` and `const isEdited = new Date(comment.updatedAt).getTime() > new Date(comment.createdAt).getTime();`. Render an Edit ghost button (before Delete, only when `canEdit && editingId !== comment.id`):
  ```tsx
  {canEdit && editingId !== comment.id && (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      title={t('pageActions.comments.edit')}
      onClick={() => {
        setEditingId(comment.id);
        setEditDraft(comment.body);
      }}
    >
      <Pencil className="h-3.5 w-3.5" />
    </Button>
  )}
  ```
  Replace the body `<p>` with a conditional editor/read view:
  ```tsx
  {editingId === comment.id ? (
    <div className="space-y-2">
      <CommentComposer
        value={editDraft}
        onChange={setEditDraft}
        onSubmit={() => void saveEdit(comment)}
        placeholder={t('pageActions.comments.placeholder')}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={editSaving || editDraft.trim().length === 0}
          onClick={() => void saveEdit(comment)}
        >
          {editSaving ? t('pageActions.comments.editSaving') : t('pageActions.comments.editSave')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setEditingId(null)}
        >
          {t('pageActions.comments.editCancel')}
        </Button>
      </div>
    </div>
  ) : (
    <p className="whitespace-pre-wrap break-words">
      {comment.body}
      {isEdited && (
        <span className="text-muted-foreground ml-1 text-xs">
          ({t('pageActions.comments.edited')})
        </span>
      )}
    </p>
  )}
  ```
- [ ] Run to fail/pass: `source ~/.zshenv && pnpm vitest run tests/api/comments-item-routes.test.ts && pnpm typecheck` (typecheck confirms the panel compiles against the widened route).
- [ ] Commit: `feat(comments): inline edit affordance on own comments in the panel`

---

## T2 — Comment reactions (Notion-style emoji) — OPTIONAL / STRETCH (net-new)

> **SCOPE NOTE:** This sub-item is **net-new**, beyond the v0.9.8 audit findings (no GH issue backs it). Treat it as **optional/stretch**: build only if T1 lands clean and the group gate budget allows. If cut, it must be cut as a whole unit (schema + API + UI) — do NOT ship a half-wired table. The gate task below explicitly tolerates T2 being absent.

**Design:** A `comment_reactions` table records one `(comment_id, user_id, emoji)` row per reaction, uniquely constrained so a user can react once per emoji per comment. `GET /api/pages/:pageId/comments` is extended to attach an aggregated `reactions` array (`{ emoji, count, reactedByMe }[]`) per comment. A `POST /api/comments/:commentId/reactions { emoji }` endpoint toggles the current user's reaction (insert if absent, delete if present) and returns the refreshed aggregate. The panel renders a reaction bar under each body with a small fixed emoji picker (👍 ❤️ 🎉 👀 ✅ 😄) plus existing reaction pills.

**Files:**
- Create `drizzle/migrations/0062_comment_reactions.sql`
- Modify `src/db/schema/comments.ts` (add `commentReactions` table + types)
- Create `src/lib/comments/reactions.ts`
- Create `tests/lib/comments/reactions.test.ts`
- Create `src/app/api/comments/[commentId]/reactions/route.ts`
- Create `tests/api/comment-reactions-routes.test.ts`
- Modify `src/lib/comments/list.ts` (attach aggregated reactions)
- Modify `tests/lib/comments/list.test.ts`
- Modify `src/components/comments/comment-panel.tsx` (reaction bar)
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json`

### Steps

- [ ] Add the Drizzle table to `src/db/schema/comments.ts` (after the `comments` table + types):
  ```ts
  import { unique } from 'drizzle-orm/pg-core';
  // ...
  export const commentReactions = pgTable(
    'comment_reactions',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      commentId: uuid('comment_id')
        .notNull()
        .references(() => comments.id, { onDelete: 'cascade' }),
      userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
      emoji: text('emoji').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({
      commentIdx: index('comment_reactions_comment_idx').on(t.commentId),
      uniqPerUser: unique('comment_reactions_uniq').on(t.commentId, t.userId, t.emoji),
    }),
  );

  export type CommentReaction = typeof commentReactions.$inferSelect;
  export type NewCommentReaction = typeof commentReactions.$inferInsert;
  ```
  (`comments` already re-exports via `src/db/schema/index.ts` line 19, so no index edit is needed.)
- [ ] Hand-author migration `drizzle/migrations/0062_comment_reactions.sql` (full SQL — `db:generate` would not emit the FK ON DELETE or unique index reliably; write it by hand per project convention):
  ```sql
  CREATE TABLE "comment_reactions" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"comment_id" uuid NOT NULL,
  	"user_id" uuid NOT NULL,
  	"emoji" text NOT NULL,
  	"created_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  --> statement-breakpoint
  ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
  ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
  CREATE INDEX "comment_reactions_comment_idx" ON "comment_reactions" USING btree ("comment_id");--> statement-breakpoint
  CREATE UNIQUE INDEX "comment_reactions_uniq" ON "comment_reactions" USING btree ("comment_id","user_id","emoji");
  ```
  Append the matching journal entry to `drizzle/migrations/meta/_journal.json` (tag `0062_comment_reactions`, next idx) — verify with `runMigrations` against a fresh Testcontainers DB in the next step.
- [ ] Write failing helper test `tests/lib/comments/reactions.test.ts` (Testcontainers boilerplate as in `delete.test.ts`; add `comment_reactions` to the TRUNCATE list). Cases:
  - first toggle inserts → aggregate `[{ emoji:'👍', count:1, reactedByMe:true }]`;
  - same user toggles same emoji again → row removed → empty aggregate;
  - two distinct users react with 👍 → `count:2`; for user B, `reactedByMe:true`; querying as user C → `reactedByMe:false`;
  - reacting to a comment in another workspace's page is rejected at the API layer (helper itself is comment-id scoped; cross-workspace guard is the route's job — assert in the route test).
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/comments/reactions.test.ts` (fails: `src/lib/comments/reactions.ts` missing + migration not yet applied).
- [ ] Minimal impl `src/lib/comments/reactions.ts`:
  ```ts
  import { and, eq, sql } from 'drizzle-orm';
  import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
  import * as schema from '@/db/schema';

  export type ReactionAggregate = { emoji: string; count: number; reactedByMe: boolean };

  /** Toggle the actor's reaction, then return the comment's fresh aggregate. */
  export async function toggleReaction(
    db: PostgresJsDatabase<typeof schema>,
    input: { commentId: string; userId: string; emoji: string },
  ): Promise<ReactionAggregate[]> {
    const existing = await db
      .select({ id: schema.commentReactions.id })
      .from(schema.commentReactions)
      .where(
        and(
          eq(schema.commentReactions.commentId, input.commentId),
          eq(schema.commentReactions.userId, input.userId),
          eq(schema.commentReactions.emoji, input.emoji),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await db
        .delete(schema.commentReactions)
        .where(eq(schema.commentReactions.id, existing[0].id));
    } else {
      await db
        .insert(schema.commentReactions)
        .values({ commentId: input.commentId, userId: input.userId, emoji: input.emoji });
    }
    return aggregateReactions(db, [input.commentId], input.userId).then(
      (m) => m.get(input.commentId) ?? [],
    );
  }

  /** Aggregate reactions for many comments at once (single grouped query). */
  export async function aggregateReactions(
    db: PostgresJsDatabase<typeof schema>,
    commentIds: string[],
    viewerId: string,
  ): Promise<Map<string, ReactionAggregate[]>> {
    const out = new Map<string, ReactionAggregate[]>();
    if (commentIds.length === 0) return out;
    const rows = await db
      .select({
        commentId: schema.commentReactions.commentId,
        emoji: schema.commentReactions.emoji,
        count: sql<number>`count(*)::int`,
        reactedByMe: sql<boolean>`bool_or(${schema.commentReactions.userId} = ${viewerId})`,
      })
      .from(schema.commentReactions)
      .where(
        sql`${schema.commentReactions.commentId} = ANY(${sql`ARRAY[${sql.join(
          commentIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}]`})`,
      )
      .groupBy(schema.commentReactions.commentId, schema.commentReactions.emoji)
      .orderBy(schema.commentReactions.emoji);
    for (const r of rows) {
      const list = out.get(r.commentId) ?? [];
      list.push({ emoji: r.emoji, count: r.count, reactedByMe: r.reactedByMe });
      out.set(r.commentId, list);
    }
    return out;
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/comments/reactions.test.ts`.
- [ ] Commit: `feat(comments): comment_reactions table + toggle/aggregate helpers (migration 0062)`
- [ ] Extend the list helper so the panel gets reactions in one fetch. Modify `src/lib/comments/list.ts` to return `CommentWithReactions[]`:
  ```ts
  import { aggregateReactions, type ReactionAggregate } from './reactions';

  export type CommentWithReactions = schema.Comment & { reactions: ReactionAggregate[] };

  export async function listComments(
    db: PostgresJsDatabase<typeof schema>,
    pageId: string,
    workspaceId: string,
    viewerId: string,
  ): Promise<CommentWithReactions[]> {
    const rows = await db
      .select()
      .from(schema.comments)
      .where(
        and(
          eq(schema.comments.targetType, 'page'),
          eq(schema.comments.targetId, pageId),
          eq(schema.comments.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(schema.comments.createdAt));
    const agg = await aggregateReactions(
      db,
      rows.map((r) => r.id),
      viewerId,
    );
    return rows.map((r) => ({ ...r, reactions: agg.get(r.id) ?? [] }));
  }
  ```
  Update `src/app/api/pages/[pageId]/comments/route.ts` GET to pass `ctx.userId`: `listComments(getDb(), pageId, ctx.workspaceId, ctx.userId)`. Update `tests/lib/comments/list.test.ts` callers to the new 4-arg signature and assert `reactions: []` on a fresh comment.
- [ ] Run to fail/pass: `source ~/.zshenv && pnpm vitest run tests/lib/comments/list.test.ts tests/api/comments-page-routes.test.ts && pnpm typecheck`.
- [ ] Commit: `feat(comments): attach aggregated reactions to page comment listings`
- [ ] Write failing route test `tests/api/comment-reactions-routes.test.ts` (copy the mock/`setActor`/`call` scaffold from `tests/api/comments-item-routes.test.ts`; route is `POST /api/comments/[commentId]/reactions`). Cases:
  - author POST `{ emoji:'👍' }` → 200, aggregate `count:1 reactedByMe:true`;
  - same actor POST `{ emoji:'👍' }` again → 200, empty aggregate (toggled off);
  - emoji not in allowlist → 400;
  - actor whose workspace does not own the comment's page → 404 (no existence leak);
  - viewer-role actor → 200 (viewers may react; matches the read tier).
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/api/comment-reactions-routes.test.ts`.
- [ ] Minimal impl `src/app/api/comments/[commentId]/reactions/route.ts` (workspace-scopes the comment via a select before toggling, returning 404 cross-workspace):
  ```ts
  import { and, eq } from 'drizzle-orm';
  import { NextResponse } from 'next/server';
  import { z } from 'zod';
  import { getDb } from '@/db/client';
  import * as schema from '@/db/schema';
  import { HttpError, requireRole } from '@/lib/auth/require-role';
  import { toggleReaction } from '@/lib/comments/reactions';

  type RouteCtx = { params: Promise<{ commentId: string }> };

  const ALLOWED = ['👍', '❤️', '🎉', '👀', '✅', '😄'] as const;
  const PostInput = z.object({ emoji: z.enum(ALLOWED) });

  export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
    try {
      const { commentId } = await params;
      const ctx = await requireRole('viewer');
      const { emoji } = PostInput.parse(await req.json());
      const [owned] = await getDb()
        .select({ id: schema.comments.id })
        .from(schema.comments)
        .where(
          and(
            eq(schema.comments.id, commentId),
            eq(schema.comments.workspaceId, ctx.workspaceId),
          ),
        )
        .limit(1);
      if (!owned) throw new HttpError(404, 'Comment not found');
      const reactions = await toggleReaction(getDb(), { commentId, userId: ctx.userId, emoji });
      return NextResponse.json({ reactions });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
      }
      const message = err instanceof Error ? err.message : 'unknown';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/api/comment-reactions-routes.test.ts`.
- [ ] Commit: `feat(comments): POST reactions toggle endpoint with workspace scoping`
- [ ] Add reaction i18n keys to all three catalogs. `messages/en.json`:
  ```json
  "pageActions.comments.react": "Add reaction",
  "pageActions.comments.reactError": "Failed to update reaction"
  ```
  `messages/es.json`:
  ```json
  "pageActions.comments.react": "Añadir reacción",
  "pageActions.comments.reactError": "No se pudo actualizar la reacción"
  ```
  `messages/ar.json`:
  ```json
  "pageActions.comments.react": "إضافة تفاعل",
  "pageActions.comments.reactError": "تعذّر تحديث التفاعل"
  ```
- [ ] Commit: `feat(i18n): add comment-reaction strings (en/es/ar)`
- [ ] Wire the reaction bar into `src/components/comments/comment-panel.tsx`. Change the local state type to `CommentWithReactions` (import it from `@/lib/comments/list`) so `comments`, `setComments`, and `renderRow` carry `reactions`. Add `SmilePlus` to the lucide import and a fixed picker constant `const EMOJI = ['👍', '❤️', '🎉', '👀', '✅', '😄'] as const;`. Add the toggle handler:
  ```tsx
  async function react(comment: CommentWithReactions, emoji: string) {
    const res = await fetch(`/api/comments/${comment.id}/reactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emoji }),
    });
    if (!res.ok) {
      setError(t('pageActions.comments.reactError'));
      return;
    }
    const { reactions } = (await res.json()) as { reactions: CommentWithReactions['reactions'] };
    setComments((prev) => prev.map((c) => (c.id === comment.id ? { ...c, reactions } : c)));
  }
  ```
  In `renderRow`, after the body block, render existing pills + a popover-free inline picker (uses the shadcn `DropdownMenu`; if not already imported in this file, add `import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';`):
  ```tsx
  <div className="mt-2 flex flex-wrap items-center gap-1">
    {comment.reactions.map((r) => (
      <button
        key={r.emoji}
        type="button"
        onClick={() => void react(comment, r.emoji)}
        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
          r.reactedByMe ? 'border-primary bg-primary/10' : 'border-border'
        }`}
      >
        <span aria-hidden="true">{r.emoji}</span>
        <span>{r.count}</span>
      </button>
    ))}
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          aria-label={t('pageActions.comments.react')}
        >
          <SmilePlus className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="flex gap-1 p-1">
        {EMOJI.map((e) => (
          <DropdownMenuItem
            key={e}
            className="cursor-pointer p-1 text-base"
            onSelect={() => void react(comment, e)}
          >
            {e}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
  ```
- [ ] Run to fail/pass: `source ~/.zshenv && pnpm typecheck && pnpm lint` (typecheck confirms the panel state type matches the new GET payload; lint confirms import ordering + no `any`).
- [ ] Commit: `feat(comments): reaction bar with emoji picker in the panel`

---

## T-Gate — Plan T verification gate

Run from repo root, all must be green before opening the PR. **Full** vitest (not a subset). If T2 was cut, the reaction tests simply won't exist — the gate is still expected to pass with T1 alone.

- [ ] `source ~/.zshenv && pnpm lint` — Biome **0 errors** (auto-fixes for import order / `import type` are expected; re-run `biome check --write` then re-lint).
- [ ] `source ~/.zshenv && pnpm typecheck` — `tsc --noEmit` clean.
- [ ] i18n **none-new** check passes — every new key (`pageActions.comments.edit*`, `pageActions.comments.edited`, and if T2 shipped `pageActions.comments.react*`) is present in **all three** of `en/es/ar` with no orphan/missing key (the project's i18n Biome rule + key-parity check must report zero new/untranslated keys).
- [ ] `source ~/.zshenv && pnpm vitest run` — **FULL** suite green (needs Docker/Colima up for Testcontainers; serial forks, `isolate: true`). Confirms migration 0062 applies cleanly via `runMigrations` and no existing comment test regressed.
- [ ] `source ~/.zshenv && pnpm build` — `next build` + entrypoint tsc clean (`output: 'standalone'`).
- [ ] **e2e UI-acceptance gate** (new in v0.9.9) against the deployed image:
  - **route-reachability smoke (Playwright):** open a page with at least one comment, open the comment panel, assert the panel `aside` renders.
  - **per-feature deployed-image check (T1):** author edits their own comment inline → Save → body updates in place and the `(edited)` marker appears; a second non-author session sees the Edit pencil **absent** on that comment.
  - **per-feature deployed-image check (T2, only if shipped):** click the SmilePlus picker → choose 👍 → a `👍 1` pill appears with the active (`border-primary`) state; click the pill again → reaction count drops / pill disappears.
- [ ] Open a **single PR** onto `patches/v0.9.9` titled `feat(comments): inline edit affordance + optional reactions (#74/#255)`. PR body lists T1 (closes #74/#255) and flags T2 as net-new/optional. **HOLD for GO** — do not merge; the controller/human merges. Do not push from a subagent.

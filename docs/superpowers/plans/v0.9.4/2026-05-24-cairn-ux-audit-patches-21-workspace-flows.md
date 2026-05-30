# P21 — Workspace Create & Switch Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. One implementer subagent per task, fresh context, full task text pasted in; main thread reviews + commits between tasks.

**Goal:** Fix the two workspace-navigation papercuts the audit flagged. (1) **#81** — "Create workspace" in the switcher creates a workspace *immediately* off a bare `window.prompt` with no real naming step and no icon; replace it with a proper modal that collects a **name + icon**, validates the name is non-empty, and only then creates. (2) **#82** — switching workspaces leaves the user on whatever route they were on (commonly `/templates`) instead of landing on the new workspace's home page; redirect the switch to the workspace home.

**Architecture:** Reuse what already exists.

- **#82 root cause (read before "fixing" the wrong thing):** the app already has a correct workspace-home resolver. The dashboard route `src/app/(app)/page.tsx` calls `resolveLandingPage(db, { workspaceId, userId })` (`src/lib/workspaces/home.ts`) and `redirect(\`/pages/${landingId}\`)` — that resolver returns `workspaces.home_page_id` (when live + in-workspace) else the oldest live page else `null`. **The bug is not the resolver; it is that the switcher never navigates.** `switchTo` in `src/components/workspace-switcher.tsx` only calls `router.refresh()` after POSTing the cookie swap, so the user stays on the *current* path (e.g. `/templates`) re-rendered under the new workspace. The fix is to make a switch behave like the existing create path already does (`router.refresh(); router.push('/')`) — pushing to `/` runs the landing resolver and lands on the workspace home. **No new home/pinned setting is needed** — `home_page_id` already exists (`src/db/schema/workspaces.ts` L13) and is honored by `resolveLandingPage`.
- **#81 (modal):** there is **no `icon` column on `workspaces`** today (`src/db/schema/workspaces.ts` has no `icon`; `pages`/`spaces` do — `src/db/schema/pages.ts` L40, `src/db/schema/spaces.ts` L34). So #81 needs a one-column migration before the UI can persist an icon. The create path is already centralized: `createWorkspace` (`src/lib/workspaces/create.ts`) is the single insert, called by both `POST /api/workspaces` (`src/app/api/workspaces/route.ts`) and the signup bootstrap (`src/lib/auth/signup.ts`) — thread `icon` through the helper (optional, defaulted) so signup stays untouched. The route's Zod `CreateInput = z.object({ name: z.string().min(1).max(120) })` gains an optional `icon`. For the icon control, **reuse the existing `IconPicker`** (`src/components/icon-picker.tsx`) — it already emits the prefix-encoded `"emoji::🪨"` / `"file::<uuid>"` string the column should store (`formatIcon`/`parseIcon` in `src/lib/pages/icon-format.ts`), with a self-hosted emoji dataset that respects Cairn's strict CSP. For the modal shell, **add a themed `Dialog` UI primitive on the already-installed unified `radix-ui` package** (`import { Dialog as DialogPrimitive } from 'radix-ui'`, `^1.4.3`) — `src/components/ui/` has no Dialog yet (only `select`, `date-field`, `form`, `input`, `label`, `button`, `card`, `avatar`, `sonner`). radix `Dialog` gives Esc + outside-click dismiss + focus trap + focus restoration for free and is the WCAG-correct modal. (The hand-rolled `role="dialog"` idiom in `src/components/pages/save-as-template-dialog.tsx` works but is *not* a focus trap — prefer the radix primitive for this new modal.)

**⚠️ Cross-plan dependency — composes with P19 (`-19-menus-nav-chrome.md`):** P19 **rewrites this same `workspace-switcher.tsx`** — Task 2 adds a per-row initial/avatar badge (#77) and Task 3 moves the switcher off the native `<details>/<summary>` onto the **radix `DropdownMenu`** for Esc/outside-click dismiss (#78). This plan (P21) touches the same file's **"Create workspace" item** (#81) and **`switchTo` redirect** (#82). To avoid a merge collision and rework:

- **Land P19 first** (it does the structural rewrite of the switcher dropdown), then layer P21 on top — P21 Task 3 below assumes the **radix `DropdownMenu`** structure from P19 Task 3 and the **initial-badge helper** from P19 Task 2. If P19 has *not* landed when P21 runs, the implementer must still produce the same end state: the modal trigger replaces the `createWorkspace` `<button>`/`DropdownMenu.Item`, and `switchTo` gains the redirect — written against whichever switcher structure is current in-file (read it first).
- The "Create workspace" row in P19 is a plain `DropdownMenu.Item onSelect={() => void createWorkspace()}`. P21 changes what that item *does*: instead of calling the prompt-based `createWorkspace`, it **opens the modal**. Because radix `DropdownMenu.Item` `onSelect` closes the menu, the modal's `open` state must live in the switcher component (above the dropdown) so it survives the menu close — see Task 3.
- If the workspace icon is surfaced on switcher rows, it dovetails with P19's #77 initial-badge: prefer the **real icon when present, fall back to the initial badge**. P21 keeps this light (Task 3 note) and does **not** re-own the avatar work — that stays #77/P19.

**i18n:** flat-key JSON in `messages/{en,es,ar}.json`; client components read via `const t = useT()` from `@/lib/i18n/provider` (`t('key')`, `t('key', { count })`). Every new visible string adds a key to **all three** locale files (en authoritative; es/ar may carry the English value as a placeholder when no translation is supplied — match the existing convention for untranslated keys, e.g. the `locale.*` block). Existing key style is dotted-flat (`locale.label`, `shortcut.switchWorkspace`). Note: P19 introduces `workspaceSwitcher.heading` / `workspaceSwitcher.create` / `workspaceSwitcher.switch`; P21 adds the **modal** keys under the same `workspaceSwitcher.*` namespace — do not duplicate keys P19 already added (read the locale files first).

**Tech Stack:** React 19, `radix-ui` 1.4.3, Tailwind v4, `lucide-react`, `cn()` from `src/lib/utils.ts`, Drizzle ORM + Postgres (Testcontainers for lib/route tests), Zod v4, Vitest 4 (jsdom for component tests).

**WCAG AA + touch-target gate:** every new interactive control clears ≥44px (`min-h-11`); the modal is a real focus-trap dialog (radix) with a labelled title, an accessible close button, and visible focus rings; the name input has an associated `<label>`; all new strings are i18n'd.

**Covers (GitHub):** #81 (create-workspace naming/icon modal), #82 (switch lands on workspace home, not /templates).

---

### Task 1: Add an `icon` column to `workspaces` (migration 0054 + Drizzle + create helper)

**Files:**
- Create: `drizzle/migrations/0054_workspace_icon.sql`
- Modify: `src/db/schema/workspaces.ts`
- Modify: `src/lib/workspaces/create.ts`
- Test: `tests/lib/workspaces/create-icon.test.ts` (Testcontainers — needs Docker)

The column is plain `text NULL` to match `pages.icon` and store the same prefix-encoded value (`emoji::…` / `file::…`). No CHECK, no FK. `createWorkspace` gains an optional `icon` so the modal can persist it while signup (`src/lib/auth/signup.ts`) keeps calling with name-only.

- [ ] **Step 1: Confirm the next migration number + read the hand-append convention**

`source ~/.zshenv && ls drizzle/migrations | tail -5` — latest is `0053_siem_forwarders.sql`, so this is **0054**. Read `src/db/schema/workspaces.ts` (the column comments document the hand-appended-FK convention; this column needs no FK). Per CLAUDE.md, `db:generate` is fine for a plain nullable column add — but writing the SQL by hand here is simpler and avoids regenerating the whole snapshot. If you run `pnpm db:generate`, verify it emits **only** the `ADD COLUMN` and update `drizzle/migrations/meta` accordingly; otherwise hand-write the SQL below and bump the meta journal to match the existing pattern.

- [ ] **Step 2: Write the migration**

```sql
-- 0054_workspace_icon.sql
-- v0.9.4 UX audit #81 — workspaces get an optional icon (prefix-encoded
-- "emoji::<unicode>" / "file::<uuid>", same convention as pages.icon).
ALTER TABLE "workspaces" ADD COLUMN "icon" text;
```

- [ ] **Step 3: Add the column to the Drizzle table**

In `src/db/schema/workspaces.ts`, add after `name`:

```ts
  // v0.9.4 UX audit #81 — optional workspace icon, prefix-encoded like
  // pages.icon ("emoji::🪨" / "file::<uuid>"). text NULL; no FK.
  icon: text('icon'),
```

(`text` is already imported.)

- [ ] **Step 4: Thread `icon` through `createWorkspace` (failing test first)**

Write `tests/lib/workspaces/create-icon.test.ts` using `tests/helpers/db.ts` (`startPostgres`/`stopPostgres`, TRUNCATE in `beforeEach`). Assert: (a) `createWorkspace(db, { name: 'Acme', ownerUserId, icon: 'emoji::🪨' })` persists `icon = 'emoji::🪨'`; (b) calling **without** `icon` leaves it `null` (signup back-compat). Model the setup on an existing `tests/lib/workspaces/*.test.ts` if present (grep `tests/lib/workspaces`); otherwise mirror a sibling lib test.

Run: `source ~/.zshenv && pnpm vitest run tests/lib/workspaces/create-icon.test.ts`
Expected: FAIL — `CreateWorkspaceInput` has no `icon`, the insert ignores it.

- [ ] **Step 5: Implement**

In `src/lib/workspaces/create.ts`, extend the input type and the insert (keep the transaction, the slug, the owner-member insert, and the `registerTrashPurgeCron` call exactly as-is):

```ts
export type CreateWorkspaceInput = {
  name: string;
  ownerUserId: string;
  icon?: string | null;
};
// …inside the transaction, the workspaces insert:
    const [ws] = await tx
      .insert(schema.workspaces)
      .values({ name: input.name, slug: slugFor(input.name), icon: input.icon ?? null })
      .returning();
```

- [ ] **Step 6: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/workspaces/create-icon.test.ts && pnpm lint && pnpm typecheck` (Docker up: `colima start` if needed).
Expected: PASS, clean. `src/lib/auth/signup.ts` still typechecks (it calls `createWorkspace` name-only — `icon` is optional).

- [ ] **Step 7: Commit**

```bash
git add drizzle/migrations/0054_workspace_icon.sql drizzle/migrations/meta src/db/schema/workspaces.ts src/lib/workspaces/create.ts tests/lib/workspaces/create-icon.test.ts
git commit -m "feat(workspaces): add optional icon column + thread through create helper — refs #81"
```

---

### Task 2: Accept `icon` on the create route (#81 backend)

**Files:**
- Modify: `src/app/api/workspaces/route.ts`
- Test: `tests/api/workspaces/create-icon.test.ts` (route test; mocks auth per CLAUDE.md `vi.mock('@/lib/auth/config')` + `__set` helper — read a sibling `tests/api/workspaces/*.test.ts` for the exact mock shape)

The route's `CreateInput` must accept an optional `icon` and pass it to `createWorkspace`. Validation: name stays `min(1).max(120)` (the modal also validates client-side, but the server is the source of truth). `icon` is an optional bounded string (it holds a short prefix-encoded value; cap it defensively).

- [ ] **Step 1: Write the failing test**

Model on the existing workspaces-route test (grep `tests/api/workspaces` — if none, mirror the closest `tests/api/**` route test that mocks auth). Assert: (a) `POST` with `{ name: 'Acme', icon: 'emoji::🪨' }` → 201 and the returned workspace has `icon: 'emoji::🪨'`; (b) `POST` with `{ name: '' }` → 400 (validation); (c) `POST` with `{ name: 'Acme' }` (no icon) → 201, `icon` null. Reuse the auth-mock `__set` helper to fake the session `userId`.

Run: `source ~/.zshenv && pnpm vitest run tests/api/workspaces/create-icon.test.ts`
Expected: FAIL — `icon` is stripped by the current schema, so (a) returns `icon: null`.

- [ ] **Step 2: Implement**

In `src/app/api/workspaces/route.ts`:

```ts
const CreateInput = z.object({
  name: z.string().min(1).max(120),
  icon: z.string().max(300).nullish(),
});
// …in the handler:
    const parsed = CreateInput.parse(await req.json().catch(() => ({})));
    const ws = await createWorkspace(getDb(), {
      name: parsed.name,
      ownerUserId: ctx.userId,
      icon: parsed.icon ?? null,
    });
```

Keep the existing cookie-set (active workspace) + `NextResponse.json(ws, { status: 201 })` + the `HttpError`/`ZodError`/500 mapping untouched.

- [ ] **Step 3: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/api/workspaces/create-icon.test.ts && pnpm lint && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/workspaces/route.ts tests/api/workspaces/create-icon.test.ts
git commit -m "feat(api): accept optional icon on workspace create — refs #81"
```

---

### Task 3: Add a themed `Dialog` UI primitive (radix-ui)

**Files:**
- Create: `src/components/ui/dialog.tsx`
- Test: `tests/components/ui/dialog.test.tsx`

Build a reusable focus-trap modal on the unified `radix-ui` `Dialog` so the create modal (Task 4) and any future modal can reuse it. Mirror the shadcn new-york token usage already in `src/components/ui/select.tsx` (`bg-popover`/`text-popover-foreground`, `cn()`, animation data-attrs).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

afterEach(cleanup);

describe('<Dialog>', () => {
  it('renders an accessible modal with a discernible title when open', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'New workspace' });
    expect(dialog).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/ui/dialog.test.tsx`
Expected: FAIL — module `@/components/ui/dialog` not found.

- [ ] **Step 3: Implement the primitive**

```tsx
'use client';

import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = 'DialogOverlay';

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { closeLabel?: string }
>(({ className, children, closeLabel = 'Close', ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 grid w-full max-w-[28rem] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-popover p-6 text-popover-foreground shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        aria-label={closeLabel}
        className="absolute right-4 top-4 flex min-h-11 min-w-11 items-center justify-center rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = 'DialogContent';

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 text-left', className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
  );
}

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base font-semibold', className)}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
```

The `closeLabel` prop lets Task 4 pass an i18n'd `aria-label` (the radix `Close` needs a discernible name; the `X` glyph is `aria-hidden`). The close button carries `min-h-11 min-w-11` for the touch-target gate.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/ui/dialog.test.tsx`
Expected: PASS. If `bg-popover`/`popover-foreground` tokens are undefined, they were confirmed present by P01 (Select primitive) — grep `src/app/globals.css` `@theme` to confirm before touching anything.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/dialog.tsx tests/components/ui/dialog.test.tsx
git commit -m "feat(ui): add themed Dialog primitive (radix-ui) — refs #81"
```

---

### Task 4: Build the `WorkspaceCreateDialog` (name + icon, validates non-empty) (#81)

**Files:**
- Create: `src/components/workspace-create-dialog.tsx`
- Test: `tests/components/workspace-create-dialog.test.tsx` (create)

A controlled modal that collects a workspace **name** (required, non-empty, ≤120) and an optional **icon** (reusing `IconPicker`), POSTs to `/api/workspaces`, and on success refreshes + navigates to `/` (so the new workspace's home resolves — it becomes the active workspace via the cookie the route already sets). The modal owns the create network call so the switcher stays a thin trigger.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceCreateDialog } from '@/components/workspace-create-dialog';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
// IconPicker dynamically imports emoji-picker-element (a web component) — stub it
// so the modal renders in jsdom without the picker's browser-only deps.
vi.mock('@/components/icon-picker', () => ({
  IconPicker: ({ onChange }: { onChange: (v: string | null) => void }) => (
    <button type="button" onClick={() => onChange('emoji::🪨')}>
      pick-icon
    </button>
  ),
}));

afterEach(cleanup);

describe('<WorkspaceCreateDialog>', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('disables Create until a non-empty name is entered, then POSTs name + icon', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'ws1' }), { status: 201 }),
      );
    render(<WorkspaceCreateDialog open onOpenChange={() => {}} />);

    const submit = screen.getByRole('button', { name: /create workspace/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true); // empty name → disabled

    fireEvent.change(screen.getByLabelText(/workspace name/i), { target: { value: '  ' } });
    expect((submit as HTMLButtonElement).disabled).toBe(true); // whitespace-only → still disabled

    fireEvent.change(screen.getByLabelText(/workspace name/i), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'pick-icon' }));
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submit);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Acme', icon: 'emoji::🪨' }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/workspace-create-dialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the modal**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { IconPicker } from '@/components/icon-picker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n/provider';

export function WorkspaceCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const router = useRouter();
  const nameId = useId();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset fields each time the modal opens.
  useEffect(() => {
    if (open) {
      setName('');
      setIcon(null);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= 120 && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed, icon }),
      });
      if (!res.ok) {
        throw new Error(t('workspaceSwitcher.createError'));
      }
      onOpenChange(false);
      // The route already set the active-workspace cookie; refresh + go to '/'
      // so resolveLandingPage lands on the new workspace's home page.
      router.refresh();
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workspaceSwitcher.createError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('workspaceSwitcher.modalClose')}>
        <DialogHeader>
          <DialogTitle>{t('workspaceSwitcher.modalTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t('workspaceSwitcher.iconLabel')}
              </span>
              <IconPicker value={icon} onChange={setIcon} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor={nameId} className="text-xs font-medium text-muted-foreground">
                {t('workspaceSwitcher.nameLabel')}
              </label>
              <Input
                id={nameId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('workspaceSwitcher.namePlaceholder')}
                maxLength={120}
                autoFocus
                required
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t('workspaceSwitcher.modalCancel')}
            </Button>
            <Button type="submit" className="min-h-11" disabled={!canSubmit}>
              {busy ? t('workspaceSwitcher.creating') : t('workspaceSwitcher.modalCreate')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

New i18n keys (add to `messages/en.json`, then mirror into `es.json` + `ar.json`):
- `workspaceSwitcher.modalTitle` → `"New workspace"`
- `workspaceSwitcher.nameLabel` → `"Workspace name"`
- `workspaceSwitcher.namePlaceholder` → `"e.g. Acme HQ"`
- `workspaceSwitcher.iconLabel` → `"Icon"`
- `workspaceSwitcher.modalCreate` → `"Create workspace"`
- `workspaceSwitcher.modalCancel` → `"Cancel"`
- `workspaceSwitcher.modalClose` → `"Close"`
- `workspaceSwitcher.creating` → `"Creating…"`
- `workspaceSwitcher.createError` → `"Couldn't create the workspace. Try again."`

> **i18n note:** if P19 already added `workspaceSwitcher.create` (its "Create workspace" menu item label), **reuse it** for the menu trigger in Task 5 — but the modal's submit button uses `workspaceSwitcher.modalCreate` (same English text, distinct key so the menu item and the modal CTA can diverge in translation). Read the locale files before adding to avoid duplicate keys.

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/workspace-create-dialog.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean. (`autoFocus` lint warning, if Biome flags it, is acceptable in a modal that opens on user action — suppress with a scoped `biome-ignore` only if lint fails.)

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace-create-dialog.tsx tests/components/workspace-create-dialog.test.tsx messages/en.json messages/es.json messages/ar.json
git commit -m "feat(workspace-switcher): name+icon create modal with non-empty validation — refs #81"
```

---

### Task 5: Wire the modal into the switcher + redirect switch to workspace home (#81 + #82)

**Files:**
- Modify: `src/components/workspace-switcher.tsx`
- Test: `tests/components/workspace-switcher-create.test.tsx` (create)

This is the integration task that closes **both** issues in the one file the audit pointed at. **Read the current `src/components/workspace-switcher.tsx` first** — its structure depends on whether P19 has landed (radix `DropdownMenu`) or not (native `<details>`). Apply the same end state either way:

1. **#81:** replace the prompt-based `createWorkspace` flow with the modal. Remove the `createWorkspace()` function (the `window.prompt` + `fetch` + `push('/')`); add `const [createOpen, setCreateOpen] = useState(false);` and render `<WorkspaceCreateDialog open={createOpen} onOpenChange={setCreateOpen} />` at the top level of the component (a sibling of the dropdown, so it survives the menu closing). The "Create workspace" menu item/button now calls `() => setCreateOpen(true)` instead of `createWorkspace`. The modal owns the POST + redirect.
2. **#82:** in `switchTo`, after `router.refresh()`, add `router.push('/')` so the switch lands on the new workspace's home (`resolveLandingPage` runs at `/`). Mirror exactly what the old create path already did. Guard the no-op switch (`id === activeId`) so re-selecting the current workspace doesn't bounce to `/`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
// Stub the modal so opening it is observable without IconPicker's browser deps.
vi.mock('@/components/workspace-create-dialog', () => ({
  WorkspaceCreateDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="New workspace" /> : null,
}));

afterEach(() => {
  cleanup();
  push.mockClear();
  refresh.mockClear();
});

describe('<WorkspaceSwitcher> create + switch', () => {
  it('opens the create modal instead of prompting', () => {
    render(
      <WorkspaceSwitcher
        workspaces={[{ id: 'a', name: 'Acme', role: 'owner' }]}
        activeId="a"
      />,
    );
    // open the dropdown (native <summary> or radix trigger — match the real label)
    fireEvent.click(screen.getByRole('button', { name: /switch workspace/i }));
    fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));
    expect(screen.getByRole('dialog', { name: /new workspace/i })).toBeTruthy();
  });

  it('navigates to "/" after switching workspaces (lands on workspace home, not /templates)', async () => {
    render(
      <WorkspaceSwitcher
        workspaces={[
          { id: 'a', name: 'Acme', role: 'owner' },
          { id: 'b', name: 'Beta', role: 'editor' },
        ]}
        activeId="a"
      />,
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: /switch workspace/i }));
    fireEvent.click(screen.getByRole('button', { name: /beta/i }));
    // allow the switchTo promise chain to settle
    await Promise.resolve();
    await Promise.resolve();
    expect(push).toHaveBeenCalledWith('/');
  });
});
```

> If P19 landed (radix `DropdownMenu`), the rows are `role="menuitem"` and the trigger label is `workspaceSwitcher.switch`; if not, they're `<button>`s under `<details>`. Adjust the queries to the **real** roles/labels in-file. The two behavioural assertions (modal opens; `push('/')` after switch) are the load-bearing part — keep them.

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/workspace-switcher-create.test.tsx`
Expected: FAIL — today "Create workspace" calls `window.prompt` (no `dialog` appears, and jsdom `prompt` returns `null`), and `switchTo` never calls `push`.

- [ ] **Step 3: Implement**

Edit `src/components/workspace-switcher.tsx`:
- Add imports: `import { WorkspaceCreateDialog } from '@/components/workspace-create-dialog';` and (if not already from P19) `import { useT } from '@/lib/i18n/provider';`.
- Add state: `const [createOpen, setCreateOpen] = useState(false);`.
- **Delete** the entire `createWorkspace` async function (prompt + fetch + refresh + push).
- In `switchTo`, after `setBusy(false); router.refresh();` add `router.push('/');` (keep the early `return` when `id === activeId || busy`).
- Change the "Create workspace" item's handler from `() => void createWorkspace()` to `() => setCreateOpen(true)`.
- Render `<WorkspaceCreateDialog open={createOpen} onOpenChange={setCreateOpen} />` as the **last child of the component's outermost element** (outside the `<details>`/`DropdownMenu.Root` so it isn't unmounted when the menu closes). If the component currently returns the dropdown directly, wrap it: `return (<>{/* dropdown */}<WorkspaceCreateDialog open={createOpen} onOpenChange={setCreateOpen} /></>);`.
- Route the "Create workspace" label through `t('workspaceSwitcher.create')` (reuse P19's key if present; otherwise add it to all three locale files alongside the Task 4 keys).

If P19 has **not** landed and the file is still the native `<details>`: keep the `<details>` for now (P19 will move it to radix), only swap the create handler + add the redirect. Do **not** pre-emptively do P19's radix rewrite here — keep this plan's diff scoped to #81/#82.

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/workspace-switcher-create.test.tsx && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS, clean build. Re-run any pre-existing switcher tests (`pnpm vitest run tests/components/workspace-switcher`) — if P19's avatar/dismiss tests exist, they must still pass (this task doesn't change the dropdown structure, only the create handler + the switch redirect). `pnpm build` is run because the switcher is rendered in the app shell on every authenticated route.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace-switcher.tsx tests/components/workspace-switcher-create.test.tsx messages/en.json messages/es.json messages/ar.json
git commit -m "fix(workspace-switcher): name+icon modal on create; switch lands on workspace home — Closes #81 Closes #82"
```

---

### Task 6 (optional polish): Surface the workspace icon on the switcher

> **Composes with P19 #77.** Only do this if P19's initial-badge (#77) has landed — otherwise **skip and leave for #77**, since P21 should not own the avatar/badge work. This task is purely a visual upgrade: when a workspace has a stored `icon`, render it on the switcher trigger + rows in place of the initial-badge fallback.

**Files:**
- Modify: `src/lib/workspaces/list.ts` (add `icon` to the select + `UserWorkspace` type)
- Modify: `src/components/workspace-switcher.tsx` (`SwitcherWorkspace` type + row/trigger render)
- Test: extend `tests/components/workspace-switcher-create.test.tsx` or P19's avatar test

- [ ] **Step 1:** Add `icon: schema.workspaces.icon` to the `listUserWorkspaces` select and `icon: string | null` to `UserWorkspace`; add `icon?: string | null` to `SwitcherWorkspace`.
- [ ] **Step 2:** In the row/trigger, render the parsed icon via the existing `PageIconRender`-style path (`parseIcon` from `src/lib/pages/icon-format.ts` → emoji glyph or `file::` image URL) when present; **fall back to P19's `initial(w.name)` badge** when `icon` is null. Reuse `src/components/page-icon-render.tsx` if it accepts a raw stored value; otherwise render the emoji glyph inline for the emoji case and the initial badge for everything else (keep it simple — file-icon rendering can defer to #77's badge if the render component isn't drop-in).
- [ ] **Step 3:** Verify `pnpm vitest run tests/components/workspace-switcher* && pnpm lint && pnpm typecheck`. No new strings (icons are not text). 
- [ ] **Step 4:** Commit `fix(workspace-switcher): show workspace icon on trigger + rows — refs #77 #81`.

---

## Self-Review

- **Coverage:** #81 (Tasks 1–5: migration + create helper + route + Dialog primitive + modal + switcher wiring) and #82 (Task 5: `switchTo` → `router.push('/')` so `resolveLandingPage` lands on the workspace home). ✓
- **#82 diagnosed correctly:** the home resolver already exists and works at `/`; the only bug is the switcher never navigating. The fix mirrors the create path that *already* did `push('/')`. No new home/pinned setting invented (`home_page_id` already honored). ✓
- **#81 backend gap surfaced:** `workspaces` had **no `icon` column** — Task 1 adds migration 0054 + threads `icon` through the centralized `createWorkspace` helper (signup stays untouched via an optional arg), Task 2 accepts it on the route with server-side non-empty name validation. The UI reuses the existing `IconPicker` + its prefix-encoding, so no new emoji/CSP work. ✓
- **radix Dialog reused:** Task 3 adds `ui/dialog.tsx` on the installed `radix-ui` (focus trap + Esc + outside-click + focus restore for free), matching the `ui/select.tsx` token/`cn()` idiom. The modal validates non-empty (client `canSubmit` + server Zod `min(1)`). ✓
- **P19 dependency documented:** the cross-plan note + Task 5's "read the file first / land P19 first" guidance ensure the create-modal + switch-redirect compose with P19's radix `DropdownMenu` (#78) and initial-badge (#77) rewrite without collision; Task 6 is an explicit optional that defers to #77. ✓
- **WCAG AA + ≥44px:** radix focus-trap dialog with labelled title, accessible close button (`min-h-11 min-w-11`, `aria-label`), `<label>`-associated name input, visible focus rings; modal CTA/cancel buttons `min-h-11`. ✓
- **i18n:** every new visible string is a `workspaceSwitcher.*` key added to all three locale files; reuses P19's `workspaceSwitcher.create`/`workspaceSwitcher.switch` where present (read locale files first to avoid dupes). ✓
- **Per-task commits:** Tasks 1–4 use `refs #81` (incremental backend/primitives); Task 5 carries `Closes #81 Closes #82` (the user-visible behaviour lands there). Lint + typecheck gate every task; `pnpm build` on Task 5 (switcher is in the app shell). No `git push` — controller/human pushes (CLAUDE.md). ✓

# P17 — Workspace Settings Surfaces (Members + General + Sidebar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Read every referenced file in-file before editing — line numbers below are anchors, not contracts.

**Goal:** Fix six audit findings in the Workspace settings area: an owner-removal footgun on the Members table (#62), lowercase role labels (#63), a missing "Invite member" CTA (#64), a native `<select>` home-page picker (#65), a no-op "Require 2FA" control (#66), and a settings sidebar that doesn't expand sub-pages for the active section (#67).

**Architecture:** Three client components and one nav component change; no schema migration. The Members table (`members-table.tsx`) gains owner-safe disabling, Title-Case role rendering, and a CTA linking to the existing invites flow. General settings (`settings-form.tsx`) swaps its native home-page `<select>` for the existing themed `ui/select` primitive (shipped v0.9.3) and gates the unenforced 2FA control behind a build-time flag. The settings sidebar (`sidebar.tsx`) grows a static sub-page map so the active section expands inline. **Security:** the server-side owner-removal guard already exists in `src/lib/workspaces/admin-members.ts` (`removeMember` → `CANNOT_REMOVE_OWNER`; role-demotion → `LAST_OWNER`); this plan adds the *client* guard (the UI currently disables it, but #62 wants it provably correct) and adds a regression test that pins the server guard so the no-last-owner invariant can't silently regress.

**Tech Stack:** Next.js 16 (App Router, React 19, TypeScript strict), Tailwind v4, `radix-ui`-backed `ui/select`, Drizzle + Testcontainers Postgres, Vitest 4, Biome 2. `cn()` from `src/lib/utils.ts`.

**Covers:** GH #62, #63, #64, #65, #66, #67.

**Pre-flight facts established by reading the code (do not re-derive, but do re-confirm before editing):**

- `members-table.tsx` already computes `removeDisabled = isOwner || isSelf || busyId === m.userId` and `roleLocked = isOwner || isSelf`. The `Remove` `<Button>` is rendered for *every* row but disabled when `removeDisabled` — #62 is "owner row still shows a (disabled) button"; the fix is to **not render** the button on owner rows (and on self), keeping disable as the fallback for the busy case.
- Roles are stored lowercase (`'owner' | 'admin' | 'editor' | 'viewer'`) and rendered raw at `members-table.tsx` L104 (`<span>{m.role}</span>`) and in the `<option>` labels (L114-116). #63 = display Title-Case only; **keep the stored/`value` lowercase** (the PATCH body schema in the members route only accepts lowercase enums).
- The invites flow exists at `src/app/(app)/settings/workspace/invites/` (`page.tsx` + `invites-manager.tsx`), route `/settings/workspace/invites`, gated by `requireRole('admin')`.
- `ui/select` exists: `src/components/ui/select.tsx` exports `Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue`. The native picker is `settings-form.tsx` L105-117.
- `requireTwofa` is a real persisted column (`workspaces.require_2fa`, `src/db/schema/workspaces.ts` L10) and a writable settings field (`src/app/api/workspaces/[id]/settings/route.ts` L10). **Nothing reads it at sign-in** — the helper text at `settings-form.tsx` L135-138 admits enforcement is unimplemented. #66 = hide the control until enforcement ships; do not delete the column or the API field (so a future enforcement PR is non-breaking).
- The settings sidebar (`src/components/settings/sidebar.tsx`) renders a flat `SECTIONS` list; "Workspace" links to `/settings/workspace` and the Members/General sub-pages (`/settings/workspace/members`, `/settings/workspace/general`) are never surfaced. #67 = expand the active section to list its sub-pages.
- **i18n:** the catalog (`messages/{en,ar,es}.json`, ~17 keys) only covers global chrome (shortcuts, palette, locale). The Workspace settings components use hardcoded English literals throughout (`"Members"`, `"Remove"`, `"Home page"`, etc.) and there is **no Biome i18n lint rule** enforcing extraction here. New user-facing strings in this plan therefore follow the **established settings convention: hardcoded English** — matching the surrounding code. (If a later i18n sweep extracts the settings surface, these strings go with it.) Do **not** invent a translation key that has no catalog entry; `useT` returns the key verbatim on a miss, which would ship a raw `members.role.owner` string to users.
- The server-side guard lib: `src/lib/workspaces/admin-members.ts` — `removeMember` already throws `CANNOT_REMOVE_OWNER` for owner targets and `CANNOT_REMOVE_SELF` for self; `setMemberRole` throws `LAST_OWNER` when demoting the only owner. The DELETE route (`src/app/api/workspaces/[id]/members/[userId]/route.ts`) maps those to 409/400.

---

### Task 1: Owner-safe Members table + Title-Case roles (#62, #63)

**Files:**
- Modify: `src/app/(app)/settings/workspace/members/members-table.tsx`
- Test: `tests/components/settings/members-table.test.tsx` (create if absent — confirm path by `ls tests/components/settings/` first)

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MembersTable } from '@/app/(app)/settings/workspace/members/members-table';

// next/navigation is used only for router.refresh(); stub it.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

const members = [
  { userId: 'u-owner', name: 'Ona Owner', email: 'ona@x.test', role: 'owner' as const },
  { userId: 'u-admin', name: 'Ada Admin', email: 'ada@x.test', role: 'admin' as const },
  { userId: 'u-self', name: 'Me Myself', email: 'me@x.test', role: 'editor' as const },
];

function renderTable() {
  return render(
    <MembersTable workspaceId="ws-1" members={members} currentUserId="u-self" />,
  );
}

describe('<MembersTable>', () => {
  it('does not render a Remove button on the owner row', () => {
    renderTable();
    expect(screen.queryByRole('button', { name: 'Remove ona@x.test' })).toBeNull();
  });

  it('does not render a Remove button on the current-user row', () => {
    renderTable();
    expect(screen.queryByRole('button', { name: 'Remove me@x.test' })).toBeNull();
  });

  it('renders a Remove button for a removable member (admin, not self)', () => {
    renderTable();
    expect(screen.getByRole('button', { name: 'Remove ada@x.test' })).toBeTruthy();
  });

  it('renders roles Title-Cased for display (owner row)', () => {
    renderTable();
    const ownerRow = screen.getByText('Ona Owner').closest('tr')!;
    expect(within(ownerRow).getByText('Owner')).toBeTruthy();
    expect(within(ownerRow).queryByText('owner')).toBeNull();
  });

  it('keeps the role <option> values lowercase for the editable role select', () => {
    renderTable();
    const select = screen.getByRole('combobox', { name: 'Change role for ada@x.test' });
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(values).toEqual(['viewer', 'editor', 'admin']);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/settings/members-table.test.tsx`
Expected: FAIL — owner/self rows still render a (disabled) Remove button; roles render lowercase.

- [ ] **Step 3: Implement**

Add a Title-Case display helper near the top of `members-table.tsx` (module scope, below the type defs):

```tsx
// Roles are stored lowercase ('owner' | 'admin' | …). Display them Title-Cased
// without ever changing the stored value or the <option value> (#63).
const ROLE_LABELS: Record<Member['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};
```

In the row render, replace the locked-role span (L103-104):

```tsx
                  {roleLocked ? (
                    <span>{ROLE_LABELS[m.role]}</span>
                  ) : (
```

and the `<option>` label (L113-116) — value stays lowercase, label Title-Cased:

```tsx
                      {EDITABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
```

For #62, stop rendering the Remove button on owner/self rows. The `removeDisabled` busy-state still applies to removable rows. Replace the `<td className="py-2 text-right">…</td>` block (L121-131):

```tsx
                <td className="py-2 text-right">
                  {/* #62: never offer Remove on the owner row or your own row —
                      removing the last owner / yourself is blocked server-side
                      (admin-members.ts), but the control must not appear at all. */}
                  {isOwner || isSelf ? null : (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busyId === m.userId}
                      aria-label={`Remove ${m.email}`}
                      onClick={() => removeUser(m.userId)}
                    >
                      Remove
                    </Button>
                  )}
                </td>
```

`removeDisabled` is now only the busy guard; you may inline it (`disabled={busyId === m.userId}` as above) and delete the now-redundant `const removeDisabled = …` line (L97). Confirm no other reference to `removeDisabled` remains before deleting it.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/settings/members-table.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/settings/workspace/members/members-table.tsx tests/components/settings/members-table.test.tsx
git commit -m "fix(settings): hide Remove on owner/self rows + Title-Case role labels — Closes #62 Closes #63"
```

---

### Task 2: Pin the server-side owner-removal / last-owner guard (#62 security)

> The DELETE route already refuses to remove an owner (`CANNOT_REMOVE_OWNER`) and `setMemberRole` refuses to demote the last owner (`LAST_OWNER`). This task does **not** add new server logic — it adds a regression test so a future refactor cannot silently drop the invariant. If the test reveals the guard is missing or weak, fix `src/lib/workspaces/admin-members.ts` then (and only then).

**Files:**
- Test: `tests/lib/workspaces/admin-members-owner-guard.test.ts` (create; confirm `tests/lib/workspaces/` exists, else mirror an existing admin-members test path with `ls`)
- Possibly modify (only if the test fails): `src/lib/workspaces/admin-members.ts`

- [ ] **Step 1: Write the failing/regression test**

Use the project's Testcontainers Postgres harness (`tests/helpers/db.ts` — read an existing `admin-members`-adjacent integration test first to copy the exact seed/`getTestDb` helpers; do not invent helper names). The test must assert, against a real DB:

```ts
// Pseudocode shape — wire the real helpers (getTestDb / seedWorkspace / insertMember)
// from an existing integration test in tests/lib/workspaces/.
import { describe, expect, it, beforeEach } from 'vitest';
import { AdminMemberError, removeMember, setMemberRole } from '@/lib/workspaces/admin-members';

describe('admin-members owner invariants', () => {
  it('refuses to remove an owner (CANNOT_REMOVE_OWNER)', async () => {
    // seed ws with owner=u1, admin=u2
    await expect(
      removeMember(db, { workspaceId: ws, actorUserId: u2, targetUserId: u1 }),
    ).rejects.toMatchObject({ code: 'CANNOT_REMOVE_OWNER' });
  });

  it('refuses to demote the last owner (LAST_OWNER)', async () => {
    // seed ws with exactly one owner=u1
    await expect(
      setMemberRole(db, { workspaceId: ws, actorUserId: u1, targetUserId: u1, role: 'admin' }),
    ).rejects.toMatchObject({ code: 'LAST_OWNER' });
  });

  it('refuses self-removal (CANNOT_REMOVE_SELF)', async () => {
    await expect(
      removeMember(db, { workspaceId: ws, actorUserId: u1, targetUserId: u1 }),
    ).rejects.toMatchObject({ code: 'CANNOT_REMOVE_SELF' });
  });
});
```

- [ ] **Step 2: Run it**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/workspaces/admin-members-owner-guard.test.ts`
Expected: PASS (the guards already exist). If any case FAILS, the invariant is broken — fix `admin-members.ts` to throw the documented `AdminMemberError` code, re-run, then continue. (Docker/Colima must be up for Testcontainers — `colima start` if needed.)

- [ ] **Step 3: Commit**

```bash
git add tests/lib/workspaces/admin-members-owner-guard.test.ts src/lib/workspaces/admin-members.ts
git commit -m "test(settings): pin owner-removal + last-owner server guards — refs #62"
```

---

### Task 3: "Invite member" CTA on the Members page (#64)

> The CTA goes on the **page** (`members/page.tsx`, a server component) next to the heading, not inside the client table — it's a static `Link`, no client state needed. It links to the existing invites route.

**Files:**
- Modify: `src/app/(app)/settings/workspace/members/page.tsx`

- [ ] **Step 1: Add the CTA next to the "Members" heading**

Replace the heading line (L17) so the title and CTA sit in a header row. Use `Button` with `asChild` wrapping a typed `Link` (typedRoutes — `/settings/workspace/invites` is a static literal, so no `as Route` cast is required, but confirm `pnpm typecheck` is clean):

```tsx
import Link from 'next/link';
import { Button } from '@/components/ui/button';
// …existing imports…

      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Members</h1>
        <Button asChild variant="outline">
          <Link href="/settings/workspace/invites">Invite member</Link>
        </Button>
      </div>
```

(Delete the old standalone `<h1 className="mb-4 …">Members</h1>`.) Verify `Button` supports `asChild` — it does in this codebase (shadcn new-york `buttonVariants` + Radix `Slot`); if `asChild` is absent, fall back to `<Link className={buttonVariants({ variant: 'outline' })} …>`. The themed `Button` already meets the 44px target via `min-h-11` used elsewhere; if the default size is shorter, pass `size` or `className="min-h-11"` to hold WCAG AA touch-target (44px).

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`
Expected: clean. (Server-component page; no unit test needed beyond build. If a members-page render test exists, keep it green.)

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/settings/workspace/members/page.tsx
git commit -m "feat(settings): add Invite member CTA to Members page — Closes #64"
```

---

### Task 4: Themed home-page picker via `ui/select` (#65)

**Files:**
- Modify: `src/app/(app)/settings/workspace/general/settings-form.tsx`
- Test: `tests/components/settings/general-settings-form.test.tsx` (create or extend — confirm path first)

- [ ] **Step 1: Write/extend the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsForm } from '@/app/(app)/settings/workspace/general/settings-form';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

describe('<SettingsForm> home page picker', () => {
  it('renders a themed combobox trigger (not a native <select>) for Home page', () => {
    const { container } = render(
      <SettingsForm
        workspaceId="ws-1"
        initial={{ name: 'W', requireTwofa: false, homePageId: null }}
        pages={[{ id: 'p1', title: 'Welcome' }]}
      />,
    );
    // ui/select trigger has role=combobox; no native <select> should remain.
    expect(screen.getByRole('combobox', { name: /home page/i })).toBeTruthy();
    expect(container.querySelector('select')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/settings/general-settings-form.test.tsx`
Expected: FAIL — native `<select>` still present; no combobox role.

- [ ] **Step 3: Implement — swap the native `<select>` for `ui/select`**

Add the import:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
```

`ui/select`'s `Select` does not accept an empty-string `value` for "(none)" cleanly (Radix Select treats `''` specially), so use a sentinel. Keep the existing `homePage` state as `'' | <id>` for the PATCH body but map to/from a `'none'` sentinel at the boundary. Replace the home-page block (L101-121):

```tsx
      <div className="flex flex-col gap-1">
        <label htmlFor={homePageId} className="text-sm font-medium">
          Home page
        </label>
        <Select
          value={homePage === '' ? 'none' : homePage}
          onValueChange={(next) => setHomePage(next === 'none' ? '' : next)}
        >
          <SelectTrigger id={homePageId} aria-label="Home page" className="min-h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">(none)</SelectItem>
            {pages.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The page members land on after sign-in. Leave as "(none)" to use the default.
        </p>
      </div>
```

Notes: `homePageId` from `useId()` now lands on the trigger via `id`. The submit handler at L47 (`homePageId: homePage === '' ? null : homePage`) is unchanged — `homePage` is still `''`-or-id. `SelectTrigger` carries `min-h-11` for the 44px target; its themed focus ring (`focus-visible:ring-1 focus-visible:ring-ring`) satisfies AA focus visibility.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/settings/general-settings-form.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean. (Radix Select renders the listbox in a portal; the test only asserts the trigger + absence of native `<select>`, so jsdom portal behavior is not exercised.)

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/settings/workspace/general/settings-form.tsx tests/components/settings/general-settings-form.test.tsx
git commit -m "fix(settings): themed Home page picker (ui/select, dark-mode safe) — Closes #65"
```

---

### Task 5: Gate the unenforced "Require 2FA" control behind a flag (#66)

> Don't ship a no-op security control. The column + API field stay (so future enforcement is non-breaking); the **UI** is hidden until enforcement exists. Use a build-time flag so a deploy that has enforcement wired can flip it on without a code change.

**Files:**
- Modify: `src/lib/env.ts` (add the flag)
- Modify: `src/app/(app)/settings/workspace/general/settings-form.tsx`
- Test: extend `tests/components/settings/general-settings-form.test.tsx`

- [ ] **Step 1: Add the feature flag to `env.ts`**

Read `src/lib/env.ts` and add to the schema (next to the other `CAIRN_*` keys), defaulting **off** (enforcement is not implemented):

```ts
  CAIRN_ENFORCE_2FA: z.coerce.boolean().default(false),
```

This is a server-read env var. The settings form is a client component, so it cannot read `env()` directly — pass the resolved boolean down from the server page as a prop (see Step 2). Confirm the exact export shape of `env.ts` (it caches on first call — see CLAUDE.md gotcha) and follow the existing pattern for surfacing a flag to a page.

- [ ] **Step 2: Thread the flag from the page → form, and conditionally render the checkbox**

In `src/app/(app)/settings/workspace/general/page.tsx` (read it first), compute `const enforce2fa = env().CAIRN_ENFORCE_2FA;` and pass `twofaEnforcementAvailable={enforce2fa}` to `<SettingsForm …>`.

In `settings-form.tsx`, add the prop to the component signature:

```tsx
export function SettingsForm({
  workspaceId,
  initial,
  pages,
  twofaEnforcementAvailable = false,
}: {
  workspaceId: string;
  initial: Initial;
  pages: { id: string; title: string }[];
  twofaEnforcementAvailable?: boolean;
}) {
```

Wrap the entire 2FA `<div className="flex items-start gap-2">…</div>` block (L123-140) in the flag, and drop the apologetic helper text (it only existed to excuse the no-op):

```tsx
      {twofaEnforcementAvailable ? (
        <div className="flex items-start gap-2">
          <input
            id={twofaId}
            type="checkbox"
            checked={requireTwofa}
            onChange={(e) => setRequireTwofa(e.target.checked)}
            className="mt-1 size-5"
          />
          <div className="flex flex-col">
            <label htmlFor={twofaId} className="text-sm font-medium">
              Require two-factor authentication
            </label>
            <p className="text-xs text-muted-foreground">
              Members must complete 2FA at sign-in.
            </p>
          </div>
        </div>
      ) : null}
```

When the control is hidden, `requireTwofa` state still initializes from `initial.requireTwofa` and is still sent in the PATCH body unchanged — so a previously-set flag is preserved, not zeroed. Confirm this: the submit body at L40-48 sends `requireTwofa` regardless; since the user can't change it while hidden, its value round-trips. (If you'd rather not send a control the user can't see, that's fine too — but preserving the stored value is the safe default; do not flip it to `false`.) Note the checkbox got `size-5` (20px box, with the label row giving a ≥44px hit target) for AA when the flag *is* on.

- [ ] **Step 3: Update the test**

Add to `general-settings-form.test.tsx`:

```tsx
  it('hides the Require 2FA control when enforcement is unavailable (default)', () => {
    render(
      <SettingsForm
        workspaceId="ws-1"
        initial={{ name: 'W', requireTwofa: false, homePageId: null }}
        pages={[]}
      />,
    );
    expect(screen.queryByLabelText(/two-factor/i)).toBeNull();
  });

  it('shows the Require 2FA control when enforcement is available', () => {
    render(
      <SettingsForm
        workspaceId="ws-1"
        initial={{ name: 'W', requireTwofa: false, homePageId: null }}
        pages={[]}
        twofaEnforcementAvailable
      />,
    );
    expect(screen.getByLabelText(/two-factor/i)).toBeTruthy();
  });
```

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/settings/general-settings-form.test.tsx && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS, clean build.

- [ ] **Step 5: Commit**

```bash
git add src/lib/env.ts src/app/(app)/settings/workspace/general/page.tsx src/app/(app)/settings/workspace/general/settings-form.tsx tests/components/settings/general-settings-form.test.tsx
git commit -m "fix(settings): gate unenforced Require-2FA control behind CAIRN_ENFORCE_2FA flag — Closes #66"
```

---

### Task 6: Expand active settings section to show sub-pages (#67)

> The sidebar (`src/components/settings/sidebar.tsx`) is a flat list. Add a static sub-page map and, when a section is active, render its sub-pages indented beneath it. Keep the existing ArrowUp/ArrowDown roving-focus behavior working over the now-larger link set.

**Files:**
- Modify: `src/components/settings/sidebar.tsx`
- Test: `tests/components/settings/sidebar.test.tsx` (create or extend — confirm path)

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsSidebar } from '@/components/settings/sidebar';

const pathnameMock = vi.fn(() => '/settings/workspace');
vi.mock('next/navigation', () => ({ usePathname: () => pathnameMock() }));
afterEach(cleanup);

describe('<SettingsSidebar>', () => {
  it('reveals Workspace sub-pages when a Workspace route is active', () => {
    pathnameMock.mockReturnValue('/settings/workspace/members');
    render(<SettingsSidebar />);
    expect(screen.getByRole('link', { name: 'Members' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'General' })).toBeTruthy();
  });

  it('does not show Workspace sub-pages when a different section is active', () => {
    pathnameMock.mockReturnValue('/settings/account');
    render(<SettingsSidebar />);
    expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/settings/sidebar.test.tsx`
Expected: FAIL — sub-page links don't exist yet.

- [ ] **Step 3: Implement**

Add a sub-page map to the `Section` type and `SECTIONS` for Workspace (only the audit-scoped sub-pages are required: Members + General; add others only if you confirm the routes exist):

```tsx
type SubPage = { id: string; label: string; href: Route };
type Section = {
  id: string;
  label: string;
  href: Route;
  children?: SubPage[];
};
```

In `SECTIONS`, give the Workspace entry children:

```tsx
  {
    id: 'workspace',
    label: 'Workspace',
    href: '/settings/workspace' as Route,
    children: [
      { id: 'workspace-general', label: 'General', href: '/settings/workspace/general' as Route },
      { id: 'workspace-members', label: 'Members', href: '/settings/workspace/members' as Route },
    ],
  },
```

In the render, after each top-level `<Link>`, conditionally render the children when the section is active. The active check `pathname === s.href || pathname.startsWith(\`${s.href}/\`)` already returns true for sub-routes, so reuse it. Wrap each section in a fragment:

```tsx
      {SECTIONS.map((s) => {
        const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <div key={s.id}>
            <Link
              href={s.href}
              data-settings-nav
              aria-current={pathname === s.href ? 'page' : undefined}
              className={`flex min-h-11 items-center rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring ${
                active ? 'bg-accent font-medium text-accent-foreground' : 'hover:bg-accent/50'
              }`}
            >
              {s.label}
            </Link>
            {active && s.children ? (
              <div className="mt-1 ml-3 space-y-1 border-l pl-2">
                {s.children.map((c) => {
                  const childActive = pathname === c.href || pathname.startsWith(`${c.href}/`);
                  return (
                    <Link
                      key={c.id}
                      href={c.href}
                      data-settings-nav
                      aria-current={childActive ? 'page' : undefined}
                      className={`flex min-h-11 items-center rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring ${
                        childActive
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50'
                      }`}
                    >
                      {c.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
```

Notes:
- I split the active styling so the parent only gets `aria-current="page"` on an exact match (the sub-page owns the current-page semantic when you're on it) while still highlighting the parent as active. Keep this nuance — two `aria-current="page"` in one nav is a minor AA smell.
- The ArrowUp/ArrowDown handler queries `a[data-settings-nav]` across the whole nav, so sub-page links join the roving order automatically — verify by re-reading the `useEffect` (it needs no change, but confirm the `querySelectorAll` still matches both levels).
- Both levels keep `min-h-11` (44px) and the `focus:ring-2` focus ring for AA.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/settings/sidebar.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean. If an existing sidebar test asserted the old flat structure or arrow-key wrap count, update it to the new link set (keep its intent).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/sidebar.tsx tests/components/settings/sidebar.test.tsx
git commit -m "fix(settings): expand active section to show sub-pages — Closes #67"
```

---

### Task 7: Full-suite gate

- [ ] **Step 1: Run the whole gate**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green. (Docker/Colima must be running for the Testcontainers integration test added in Task 2.)

- [ ] **Step 2: Confirm each issue closes via a commit trailer**

`git log --oneline` should show `Closes #62 Closes #63`, `Closes #64`, `Closes #65`, `Closes #66`, `Closes #67` across the task commits (Task 2 is `refs #62`, a supporting test). No push from a subagent — the controller/human pushes.

---

## Self-Review

- Spec coverage: #62 (hide Remove on owner/self + server-guard regression test), #63 (Title-Case display, lowercase stored), #64 (Invite CTA → existing invites route), #65 (ui/select home-page picker), #66 (flag-gated 2FA control, column/API retained), #67 (sidebar sub-page expansion). ✓
- Security: server-side owner-removal guard already exists in `src/lib/workspaces/admin-members.ts` (`CANNOT_REMOVE_OWNER`) + last-owner demotion guard (`LAST_OWNER`) + self-removal guard (`CANNOT_REMOVE_SELF`), mapped to 409/400 in `src/app/api/workspaces/[id]/members/[userId]/route.ts`. Task 2 pins these with a Testcontainers regression test rather than re-implementing — **the only server route relevant to owner-removal is the members DELETE route, and it is already correct; no server route needs modifying for #62.** The 2FA control (#66) hides a *no-op* — it does not change any auth enforcement; the column/API are kept so a real enforcement PR is non-breaking. ✓
- i18n: the Workspace settings surface uses hardcoded English (no catalog keys exist for it, no Biome i18n rule gates it); new strings follow that established convention. No phantom `useT` keys introduced (which would render raw key strings). ✓
- a11y: new/changed controls keep `min-h-11` (44px) and visible focus rings (`focus-visible:ring-1`/`focus:ring-2 ring-ring`); the home-page picker uses the themed `ui/select` (dark-mode safe, OS cannot un-theme); avoided double `aria-current="page"`. ✓
- Reuse: `ui/select` (v0.9.3 primitive) reused, not re-created; `Button asChild` reused for the CTA. ✓
- No placeholders left except where the plan explicitly says "read the file first / confirm the path / copy the real test helpers" — the implementer must read before editing. ✓

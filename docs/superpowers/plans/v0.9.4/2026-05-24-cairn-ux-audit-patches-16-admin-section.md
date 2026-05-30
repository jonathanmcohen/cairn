# P16 — Admin Settings Section (link + role-gating) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the "Admin" item in the settings sidebar behave correctly — navigate to a real admin page when the viewer is allowed to see it, and disappear entirely when they are not. No dead nav, no 404, no silent no-op.

**Architecture:** The admin surface is **already built and routed** (see Investigation below). The residual defects in #60/#61 reduce to two things: (1) the sidebar `<Link>` target is technically correct but the destination *throws 403 for non-admins* (which renders as a do-nothing / error to most users), and (2) the issue-reported sub-route name (`/settings/admin/audit-log`) is stale — the real route is `/settings/admin/audit`. The fix is therefore **Option A — wire it up + role-gate the nav item**: keep the link pointing at the live `/settings/admin` index (which already `redirect()`s to `/settings/admin/audit`), and conditionally render the "Admin" sidebar entry only for `owner`/`admin`. The settings layout (a Server Component) resolves the caller's role via `getAuthContext()` and passes a boolean into the client `<SettingsSidebar>`.

**Tech Stack:** Next 16 App Router (RSC), React 19, `getAuthContext`/`hasMinRole` from `src/lib/auth/require-role.ts`, typedRoutes (`as Route`), Vitest + jsdom for the sidebar component test.

**Covers:** GH #60 (Admin link non-functional), #61 (admin sub-routes 404 / section appears unbuilt).

---

## Investigation findings (READ THIS FIRST — it changes the scope)

The issues were filed against v0.9.3 with the assumption that the admin UI was unbuilt. **It is built.** Mapping the tree on `patches/ux-audit-v0.9.4`:

**Real, routed, role-gated admin pages under `src/app/(app)/settings/admin/`:**
- `page.tsx` — already `redirect('/settings/admin/audit')` (index → first child). ✓
- `audit/page.tsx` — renders `<AuditViewer>` (`src/components/admin/audit-viewer.tsx`, built in v0.6.0 P18 / commit `89a51a5`). `await requireRole('admin')`.
- `api-keys/page.tsx`, `encryption/page.tsx`, `mfa/page.tsx`, `upgrade/page.tsx`, `webhooks/page.tsx`, `webhooks/[id]/deliveries/page.tsx` — all `await requireRole('admin')`.

**Additional admin pages under a DIFFERENT path — the top-level `src/app/(app)/admin/` route group:**
- `admin/sso/*` (OIDC/SAML/SCIM), `admin/siem/*`, `admin/chat-bridge/*` — built in v0.7–v0.9. These gate with `requireRole('admin').catch(() => null)` then `if (!ctx) redirect('/')`.
- **These three are orphaned**: nothing in the nav links to them (grep finds only self-referential `router.push('/admin/sso')` inside their own forms). They are reachable by direct URL only. This is a *separate* discoverability gap, **out of scope** for #60/#61 — logged as follow-up in Task 4, not fixed here.

**So why does #60 say the link "does nothing"?**
The sidebar (`src/components/settings/sidebar.tsx`) renders "Admin" for **every** signed-in user (it's a static `SECTIONS` array, no role check). For a `viewer`/`editor`, clicking it hits `/settings/admin` → `redirect('/settings/admin/audit')` → `await requireRole('admin')` → `throw new HttpError(403, …)`. With no error boundary on the settings subtree, the user perceives a broken/no-op link. For an `owner`/`admin` it already works (rank: `viewer 1 < editor 2 < admin 3 < owner 4`; `requireRole('admin')` passes for admin and owner).

**Why does #61 report a 404?** The reporter used the *old* path `/settings/admin/audit-log`. The route was renamed to `/settings/admin/audit` in the settings-hub restructure (v0.8.0 G4 P12, commit `e849a74`). There are **zero** remaining references to `audit-log` in `src/` (verified by grep), so no stale link needs fixing — only the issue's expectation was stale.

**Conclusion / recommendation:** **Option A.** The pages exist and are correctly role-gated server-side. The only real, shippable defect is the sidebar surfacing a tab that 403s for non-admins. Fix = role-gate the nav item. Option B (hide the whole tab behind a flag until built) is **rejected** — it would hide a working, shipped feature from the admins who need it. We hide it *only* from users who can't use it.

**Sibling-index precedent (for the redirect target, already correct — do not change):** `account/page.tsx` → `/settings/account/profile`, `workspace/page.tsx` → `/settings/workspace/members`, `developer/page.tsx` → `/settings/developer/api-keys`. `admin/page.tsx` → `/settings/admin/audit` matches this pattern.

---

### Task 1: Plumb the caller's role into the settings sidebar

The sidebar is a client component (`'use client'`) and currently takes no props. The settings layout is a Server Component and is the right place to resolve role. We add an optional `isAdmin` prop (default `false`, so the existing component test and any other caller keep compiling) and have the layout pass it.

**Files:**
- Modify: `src/components/settings/sidebar.tsx`
- Modify: `src/app/(app)/settings/layout.tsx`

- [ ] **Step 1: Add an `isAdmin` prop to `<SettingsSidebar>` and conditionally include the Admin section**

In `src/components/settings/sidebar.tsx`, change the component signature and filter the rendered sections. Keep `SECTIONS` as the full static list (the keyboard-nav `querySelectorAll('a[data-settings-nav]')` already walks whatever links are rendered, so dropping one entry needs no other change).

Replace the signature:

```tsx
export function SettingsSidebar({ isAdmin = false }: { isAdmin?: boolean }) {
```

Then filter the array before mapping. Inside the component body, just before the `return`:

```tsx
  const sections = SECTIONS.filter((s) => s.id !== 'admin' || isAdmin);
```

And change the `.map` source from `SECTIONS.map(...)` to `sections.map(...)`.

Do not touch the arrow-key `useEffect` — it already operates on the rendered links, so wrap-around stays correct with five or six items.

- [ ] **Step 2: Resolve role in the layout and pass it down**

Make `src/app/(app)/settings/layout.tsx` an async Server Component that reads the auth context. Replace the file with:

```tsx
import type { ReactNode } from 'react';
import { SettingsSidebar } from '@/components/settings/sidebar';
import { getAuthContext, hasMinRole } from '@/lib/auth/require-role';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthContext();
  const isAdmin = ctx?.role ? hasMinRole(ctx.role, 'admin') : false;
  return (
    <div className="mx-auto flex w-full max-w-5xl gap-8">
      <SettingsSidebar isAdmin={isAdmin} />
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}
```

`getAuthContext()` is `cache()`-wrapped, so this adds no extra query cost on a request that also gates a child page. `hasMinRole(role, 'admin')` is `true` for both `admin` and `owner` — matching exactly who `requireRole('admin')` lets through, so the visible tab and the reachable page agree.

- [ ] **Step 3: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
Expected: clean. (`getAuthContext` may return `null` — the optional-chain + ternary handles it; no non-null assertion.)

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/sidebar.tsx src/app/\(app\)/settings/layout.tsx
git commit -m "fix(settings): role-gate the Admin sidebar item to owner/admin

The Admin section was rendered for every signed-in user, but
/settings/admin redirects into requireRole('admin')-gated pages that
403 for viewers/editors — perceived as a dead/no-op link. The layout
(RSC) now resolves the caller's role via getAuthContext + hasMinRole
and only renders the Admin entry for owner/admin, matching exactly who
the server-side gate admits. The link target itself (already a working
redirect to /settings/admin/audit) is unchanged.

refs #60"
```

---

### Task 2: Update the sidebar component test for the new role-gated behavior

The existing test (`tests/components/settings/sidebar.test.tsx`) asserts all six labels render and exercises arrow-key wrap-around. With the default `isAdmin={false}`, "Admin" is now absent unless the prop is passed. Update the test to cover both states and keep the keyboard-nav assertions valid.

**Files:**
- Modify: `tests/components/settings/sidebar.test.tsx`

- [ ] **Step 1: Add admin-visibility cases and fix the existing six-label assertion**

The current first test renders `<SettingsSidebar />` (now defaulting to non-admin) and expects all six labels including "Admin" — that assertion is now wrong. Split it:

- Non-admin render (`<SettingsSidebar />`): expect the five non-admin labels present and **"Admin" absent** (`screen.queryByRole('link', { name: 'Admin' })` is `null`).
- Admin render (`<SettingsSidebar isAdmin />`): expect all six labels present.

Concretely, replace the first `it('renders all six section labels', …)` block with:

```tsx
  it('hides the Admin item for non-admins (default)', () => {
    render(<SettingsSidebar />);
    for (const label of ['Account', 'Workspace', 'Developer', 'Notifications', 'Security']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });

  it('shows the Admin item when isAdmin is true', () => {
    render(<SettingsSidebar isAdmin />);
    for (const label of [
      'Account',
      'Workspace',
      'Admin',
      'Developer',
      'Notifications',
      'Security',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
  });
```

- [ ] **Step 2: Keep the arrow-key tests valid**

The mocked `usePathname` is `/settings/workspace/members`, and the arrow-key tests reference Account/Workspace/Security. With the **default** (non-admin) render, the visible order is Account → Workspace → Developer → Notifications → Security (five items). The existing assertions:
- "arrow-down from Account → Workspace" — still valid (adjacent).
- "arrow-up from Workspace → Account" — still valid.
- "arrow-down at last item (Security) wraps to Account" — still valid (Security is still last).

No change needed to the three keyboard tests *if they run against the default render*. Confirm each of those three `it(...)` blocks renders `<SettingsSidebar />` (no `isAdmin`); if any renders with admin, drop the prop so the five-item order holds. Do not add an Admin-specific keyboard assertion (out of scope).

- [ ] **Step 3: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/settings/sidebar.test.tsx`
Expected: PASS — non-admin hides Admin, admin shows all six, arrow-nav green.

- [ ] **Step 4: Commit**

```bash
git add tests/components/settings/sidebar.test.tsx
git commit -m "test(settings): cover role-gated Admin item in settings sidebar

refs #60"
```

---

### Task 3: Confirm the admin index + sub-routes resolve (no code change expected)

This task is a verification gate, not new code. It proves #61's "sub-routes 404" is stale and the index redirect is live, so we can close #61 with evidence rather than a code change.

**Files:** none (verification only).

- [ ] **Step 1: Confirm there are no stale `audit-log` references**

Run: `source ~/.zshenv && grep -rn "settings/admin/audit-log\|admin/audit-log" src tests || echo "no stale audit-log refs"`
Expected: `no stale audit-log refs`. (The real route is `/settings/admin/audit`.) If any reference *is* found, fix it to `/settings/admin/audit` and fold the change into this task's commit; otherwise this is purely confirmatory.

- [ ] **Step 2: Confirm the index redirect target is a real child**

Read `src/app/(app)/settings/admin/page.tsx` — it must `redirect('/settings/admin/audit')`, and `src/app/(app)/settings/admin/audit/page.tsx` must exist and `await requireRole('admin')`. Both are present on this branch; do not modify. (If, and only if, the audit child were missing, this redirect would 404 — but it is not.)

- [ ] **Step 3: Build gate (this is the route-existence proof)**

Run: `source ~/.zshenv && pnpm build`
Expected: build succeeds and the route manifest includes `/settings/admin`, `/settings/admin/audit`, `/settings/admin/api-keys`, `/settings/admin/encryption`, `/settings/admin/mfa`, `/settings/admin/upgrade`, `/settings/admin/webhooks`. A successful build with these routes present is the standing proof that the sub-routes do not 404 for an authorized caller.

- [ ] **Step 4: No commit** (verification-only task; nothing changed unless Step 1 found a stray ref).

---

### Task 4: Log the orphaned top-level `/admin/*` pages as follow-up

The SSO / SIEM / chat-bridge admin pages under `src/app/(app)/admin/` are built and role-gated but **not linked from any nav** — a discoverability gap distinct from #60/#61. Record it so it is tracked, but do not fix it here (it would expand scope and needs its own design decision about where those links belong — likely additional admin sub-sections).

**Files:**
- Modify: GitHub issue #61 (via `gh issue comment`)

- [ ] **Step 1: Post a follow-up note on #61 before closing**

```bash
gh issue comment 61 --body "Investigated on \`patches/ux-audit-v0.9.4\`: the admin section is built and routed — \`/settings/admin\` redirects to \`/settings/admin/audit\` (the audit viewer shipped in v0.6.0 P18), plus api-keys / encryption / mfa / upgrade / webhooks, all gated by \`requireRole('admin')\`. The reported 404 used the stale path \`/settings/admin/audit-log\`; the route was renamed to \`/settings/admin/audit\` in the v0.8.0 settings-hub restructure. Fixed the real defect (sidebar showed Admin to non-admins → 403) by role-gating the nav item.

Separately: the top-level \`/admin/sso\`, \`/admin/siem\`, \`/admin/chat-bridge\` pages are built + gated but **not linked from any nav** (direct-URL only). Filing as a follow-up discoverability item — out of scope for this fix."
```

- [ ] **Step 2: (Optional) open a dedicated follow-up issue**

If the user wants the orphaned-pages gap tracked as its own ticket rather than a comment, open one:

```bash
gh issue create --title "Admin: SSO/SIEM/chat-bridge pages are not linked from any nav" \
  --body "\`src/app/(app)/admin/{sso,siem,chat-bridge}\` are built and \`requireRole('admin')\`-gated but reachable by direct URL only — no settings/sidebar entry points to them. Decide where they belong (likely new Admin sub-sections under /settings/admin) and add role-gated nav. Discovered during #60/#61."
```

Leave this optional — default is the comment in Step 1. Do not block the PR on it.

---

### Task 5: Full verification gate + close both issues

**Files:** none (gate + commit trailer only).

- [ ] **Step 1: Run the full gate**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green. The settings-sidebar test reflects the role-gated behavior; build confirms every `/settings/admin/*` route compiles.

- [ ] **Step 2: Confirm the closing trailer is present in the branch history**

The PR for this branch closes both issues. Ensure one commit on the branch carries the closing keywords (either fold into the final verification commit, or — if no further file change is needed — amend the Task 1 commit message to include them). The required trailer text is:

```
Closes #60 Closes #61
```

If a no-op closing commit is the cleanest option (all real changes already committed in Tasks 1–2), use:

```bash
git commit --allow-empty -m "fix(settings): admin section link + role-gating (UX audit)

Closes #60 Closes #61"
```

Prefer folding `Closes #60 Closes #61` into the Task 1 commit if you have not yet pushed; use the empty commit only if amending is impractical.

- [ ] **Step 3: Do not push** — the controller/human pushes (per CLAUDE.md).

---

## Self-Review

- **Scope coverage:** #60 (dead/no-op Admin link) fixed by role-gating the nav item; #61 (sub-routes 404 / section unbuilt) shown to be stale (real routes exist, `audit-log` renamed to `audit`) and proven by the build gate + grep, with a follow-up comment. ✓
- **Recommendation honored:** Option A (wire up + role-gate), not Option B (hide behind flag) — the pages are shipped and must stay visible to admins. ✓
- **No dead nav:** non-admins no longer see a tab that 403s; admins/owners see a tab that works. Visible-tab predicate (`hasMinRole(role,'admin')`) exactly matches the server gate (`requireRole('admin')`). ✓
- **Role-gating verified against existing pages:** every `/settings/admin/*` child already `await requireRole('admin')`; the nav gate mirrors it — no client-only gating that could be bypassed (server pages still enforce). ✓
- **Out of scope, logged not fixed:** orphaned top-level `/admin/{sso,siem,chat-bridge}` discoverability (Task 4). ✓
- **Gates:** lint + typecheck + test + build all run; sidebar test updated for the prop. ✓
- **No placeholders:** `isAdmin` defaults to `false` so no existing caller breaks; the layout passes the real resolved role. ✓

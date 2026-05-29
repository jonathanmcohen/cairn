# P19 — Menus, Navigation & Shared Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. One implementer subagent per task, fresh context, full task text pasted in; main thread reviews + commits between tasks.

**Goal:** Polish the app's shared chrome — the page `…` menu, the workspace switcher, the editor slash menu, the editor outline panel — and re-land three reopened sidebar fixes (#15, #42, #44) so they actually hold. These surfaces are touched on nearly every screen, so the WCAG AA + ≥44px touch-target gate is **strict** here: every new interactive row must clear a 44px minimum hit area (`min-h-11` ≈ 44px) and every new string must be routed through i18n.

**Architecture:** Reuse what already exists. Icons come from `lucide-react` (already the project icon set; one icon per menu item). The interactive-dismiss behaviour for the workspace switcher (#78) moves off the native `<details>/<summary>` onto the unified `radix-ui` `DropdownMenu` primitive (`import { DropdownMenu } from 'radix-ui'`, `^1.4.3` already installed) which gives Esc + outside-click dismiss + focus restoration for free. Backend wiring for the new page-menu actions (#76) reuses existing routes wherever they exist:

- **Delete / move-to-trash:** `DELETE /api/pages/[pageId]` → `softDeletePage` (`src/lib/pages/delete.ts`). **EXISTS.**
- **Move to (reparent):** `POST /api/pages/[pageId]/move` with `{ newParentId }` → `movePage` (`src/lib/pages/move.ts`). **EXISTS.**
- **Copy link (internal):** purely client-side (`navigator.clipboard.writeText(${origin}/pages/${pageId})`). **No backend needed.**
- **Duplicate page:** ⚠️ **NO authenticated backend exists.** The only duplicate helper is `duplicatePublicPage` (`src/lib/pages/duplicate.ts`) + `POST /api/pages/[pageId]/duplicate-public`, which require `published + allowDuplication` and copy across workspaces from the *public* surface. An owner duplicating their own private page in-place is unsupported. **Task 4 builds the missing backend first**, then wires the UI in Task 5.

**i18n:** flat-key JSON in `messages/{en,es,ar}.json`; client components read via `const t = useT()` from `@/lib/i18n/provider` (`t('key')`, `t('key', { count })`). Every new visible string in this plan adds a key to **all three** locale files (en authoritative; es/ar may carry the English value as a placeholder when no translation is supplied — match the existing convention in those files for untranslated keys). Existing key style is dotted-flat, e.g. `locale.label`.

**Tech Stack:** React 19, `radix-ui` 1.4.3, Tailwind v4, `lucide-react`, `cn()` from `src/lib/utils.ts`, Vitest 4 (jsdom for component tests).

**Covers (GitHub):** NEW — #75 (page-menu icons), #76 (page-menu missing actions), #77 (switcher avatars), #78 (switcher dismiss), #79 (slash-menu icons), #80 (outline panel space). REOPENED — #15 (version footer link), #42 (sidebar resize handle), #44 (sign-out separation).

**Round-1 reference commits (for the reopened tasks):**
- #15 → `0953b60` "feat(sidebar): link version footer to GitHub release notes — Closes #15"
- #42 → `0320e1f` "polish(sidebar): visible boundary border; defer drag-resize — Closes #42"
- #44 → `459c8ac` "feat(sidebar): add Settings nav entry, rebalance lower nav, separate sign out — Closes #45 Closes #14 Closes #44"

---

### Task 1: Add a lucide icon to every page `…` menu item (#75)

**Files:**
- Modify: `src/components/page-menu.tsx`
- Test: `tests/components/page-menu-icons.test.tsx` (create)

The menu currently renders text-only `<button>`s (`src/components/page-menu.tsx` L132–227). Add a leading 16px lucide icon to each action so the menu scans visually. This task is icons + i18n only — the *new actions* land in Task 5.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageMenu } from '@/components/page-menu';

// offline-context + share-panel pull in app providers; mock the action gate to "allowed".
vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));

afterEach(cleanup);

describe('<PageMenu> item icons', () => {
  it('renders a leading svg icon inside each open-menu action button', async () => {
    render(<PageMenu pageId="11111111-1111-1111-1111-111111111111" />);
    screen.getByRole('button', { name: 'Page menu' }).click();
    // "Export as .md" is always present (published=false path). It must carry an icon.
    const exportBtn = await screen.findByRole('button', { name: /export as \.md/i });
    expect(exportBtn.querySelector('svg')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/page-menu-icons.test.tsx`
Expected: FAIL — button has no `<svg>` child (text-only today). If the test instead errors on a missing provider import, mock that provider too (read the file's imports first) — but the assertion must be the failing reason.

- [ ] **Step 3: Add icons + i18n**

Add to the import block in `page-menu.tsx`:

```tsx
import {
  Activity,
  Download,
  FileUp,
  Globe,
  Link as LinkIcon,
  MoreHorizontal,
  FileStack,
  FilePlus2,
} from 'lucide-react';
import { useT } from '@/lib/i18n/provider';
```

Inside the component add `const t = useT();`. For **each** action button, prepend the icon and replace the literal label with a `t()` call. Give every action button the shared class so it clears the touch-target gate and aligns the icon — replace the repeated `block w-full px-3 py-1.5 text-left text-sm hover:bg-accent` with:

```tsx
const ITEM_CLASS =
  'flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50';
```

Then for example the export button becomes:

```tsx
<button type="button" className={ITEM_CLASS} onClick={() => { download(`/api/pages/${pageId}/export`); setOpen(false); }}>
  <Download aria-hidden="true" className="h-4 w-4 shrink-0" />
  {t('pageMenu.exportMd')}
</button>
```

Icon ↔ action map (apply to the existing buttons in-file):
- Publish to web / Unpublish → `Globe`
- Copy public link → `LinkIcon`
- Export as .md → `Download`
- Export subtree as .zip → `FileStack`
- Import markdown… → `FileUp`
- Save as template… → `FilePlus2`
- Show / Hide activity → `Activity`

New i18n keys (add to `messages/en.json`, then mirror into `es.json` + `ar.json`): `pageMenu.publish`, `pageMenu.unpublish`, `pageMenu.copyPublicLink`, `pageMenu.copied`, `pageMenu.exportMd`, `pageMenu.exportZip`, `pageMenu.importMd`, `pageMenu.saveTemplate`, `pageMenu.savedTemplate`, `pageMenu.showActivity`, `pageMenu.hideActivity`. Keep the existing `aria-label="Page menu"` as `pageMenu.trigger` and route it through `t()` too. Preserve the `disabled`/`title="Unavailable offline"` offline behaviour (also i18n the title via `pageMenu.unavailableOffline`).

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/page-menu-icons.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean. Biome will reorder the lucide import alphabetically — accept it.

- [ ] **Step 5: Commit**

```bash
git add src/components/page-menu.tsx tests/components/page-menu-icons.test.tsx messages/en.json messages/es.json messages/ar.json
git commit -m "fix(page-menu): add lucide icon + i18n to every menu item — Closes #75"
```

---

### Task 2: Workspace-switcher rows get an avatar/initial (#77)

**Files:**
- Modify: `src/components/workspace-switcher.tsx`
- Test: `tests/components/workspace-switcher-avatar.test.tsx` (create)

Each dropdown row is a bare `Check + name` today (`src/components/workspace-switcher.tsx` L59–69). Add a small square avatar showing the workspace's first initial so rows are scannable and the active row reads as more than a checkmark. There is no avatar URL on `SwitcherWorkspace` (`{ id, name, role }`), so derive a deterministic initial-badge from the name — no schema change.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

afterEach(cleanup);

describe('<WorkspaceSwitcher> row avatars', () => {
  it('shows an initial badge for each workspace row', () => {
    render(
      <WorkspaceSwitcher
        workspaces={[{ id: 'a', name: 'Acme', role: 'owner' }]}
        activeId="a"
      />,
    );
    // The trigger label "Acme" is present; the row badge renders the initial "A".
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/workspace-switcher-avatar.test.tsx`
Expected: FAIL — no `A` badge rendered.

- [ ] **Step 3: Implement the initial-badge**

Add a tiny helper above the component and a badge element inside each row button (between the `Check` and the name span):

```tsx
function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

// inside the row <button>, before the name span:
<span
  aria-hidden="true"
  className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[0.65rem] font-medium text-muted-foreground"
>
  {initial(w.name)}
</span>
```

The `Check` stays as the active indicator (keep it, it carries semantic state); the badge is `aria-hidden` decoration. If you keep both, drop the `Check`'s `mr-2` to `mr-1` so spacing stays tight. Also add an initial badge to the trigger `<summary>` next to `active?.name` for consistency. Do **not** alter `switchTo`/`createWorkspace`.

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/workspace-switcher-avatar.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS. (Note: Task 3 rewrites this same file onto radix — land #77 first so the avatar markup is in place before the primitive swap.)

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace-switcher.tsx tests/components/workspace-switcher-avatar.test.tsx
git commit -m "fix(workspace-switcher): add per-workspace initial badge — Closes #77"
```

---

### Task 3: Workspace switcher dismisses on Esc + outside-click (#78)

**Files:**
- Modify: `src/components/workspace-switcher.tsx`
- Test: `tests/components/workspace-switcher-dismiss.test.tsx` (create)

Today the switcher is a native `<details>/<summary>` (`src/components/workspace-switcher.tsx` L49–80): it stays open until the summary is clicked again — no Esc, no outside-click, no focus restoration. Move it to the unified `radix-ui` `DropdownMenu`, which provides all three behaviours and proper `role="menu"` semantics. Keep the avatar markup from Task 2.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

afterEach(cleanup);

describe('<WorkspaceSwitcher> dismiss', () => {
  it('closes the menu when Escape is pressed', async () => {
    render(<WorkspaceSwitcher workspaces={[{ id: 'a', name: 'Acme', role: 'owner' }]} activeId="a" />);
    const trigger = screen.getByRole('button', { name: /switch workspace/i });
    fireEvent.click(trigger);
    expect(await screen.findByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/workspace-switcher-dismiss.test.tsx`
Expected: FAIL — `<details>` exposes no `role="menu"`, so `findByRole('menu')` times out/throws.

- [ ] **Step 3: Re-implement on radix `DropdownMenu`**

Replace the `<details>` shell with the radix primitive. Sketch (preserve the existing avatar badge from Task 2, the `Check` active indicator, the "Create workspace" item, and the `busy` guard):

```tsx
import { DropdownMenu } from 'radix-ui';
// ...
return (
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      aria-label="Switch workspace"
      className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-sm font-medium hover:bg-accent"
    >
      {/* trigger initial badge + active?.name + ChevronDown */}
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="start"
        sideOffset={4}
        className="z-50 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      >
        <DropdownMenu.Label className="px-2 py-1.5 text-sm font-semibold">
          {t('workspaceSwitcher.heading')}
        </DropdownMenu.Label>
        {workspaces.map((w) => (
          <DropdownMenu.Item
            key={w.id}
            onSelect={() => void switchTo(w.id)}
            className="flex min-h-11 w-full cursor-pointer items-center rounded-xs px-2 py-1.5 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground"
          >
            {/* Check + initial badge + name */}
          </DropdownMenu.Item>
        ))}
        <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-muted" />
        <DropdownMenu.Item onSelect={() => void createWorkspace()} className="...min-h-11...">
          {/* Plus + Create workspace */}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);
```

Notes:
- radix `DropdownMenu.Item` `onSelect` fires on click **and** Enter/Space, and closes the menu + restores focus to the trigger automatically — this is what gives us Esc + outside-click + focus restore "for free", satisfying #78.
- `createWorkspace` uses `window.prompt`; radix closes the menu on `onSelect` *before* the prompt blocks, which is fine. If the prompt-then-close ordering misbehaves under jsdom, that's a test-env artifact — assert the close behaviour with the Escape test above, not the create path.
- i18n: route the heading + "Create workspace" + the trigger aria-label through `useT()` → keys `workspaceSwitcher.heading`, `workspaceSwitcher.create`, `workspaceSwitcher.switch`. Add to all three locale files.
- Every `min-h-11` here is the ≥44px gate — do not drop it.

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/workspace-switcher-dismiss.test.tsx tests/components/workspace-switcher-avatar.test.tsx && pnpm lint && pnpm typecheck`
Expected: both PASS. Re-run the Task-2 avatar test to confirm the badge survived the rewrite. If the older `workspace-switcher-es.test.tsx`-style test (if any) queries `<summary>`, update it to the radix trigger.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace-switcher.tsx tests/components/workspace-switcher-dismiss.test.tsx messages/en.json messages/es.json messages/ar.json
git commit -m "fix(workspace-switcher): radix DropdownMenu for Esc/outside-click dismiss + focus restore — Closes #78"
```

---

### Task 4: Add an authenticated single-page duplicate backend (#76 prerequisite)

> **SUB-TASK FLAGGED IN ARCHITECTURE:** "Duplicate page" has **no existing backend**. This task builds it; Task 5 wires the UI. Delete, Move-to, and Copy-link all reuse existing routes/no-backend and are handled entirely in Task 5.

**Files:**
- Create: `src/lib/pages/duplicate-owned.ts`
- Create: `src/app/api/pages/[pageId]/duplicate/route.ts`
- Test: `tests/lib/pages/duplicate-owned.test.ts` (Testcontainers — needs Docker)

Build an in-workspace deep-copy that an editor/owner can run on a page they can access (no `published`/`allowDuplication` requirement, unlike `duplicatePublicPage`). Copy title (prefixed "Copy of "), icon, cover, and content for the whole subtree; remap parent pointers; mint fresh ids; the copied root keeps the source's `parent_id` (sibling of the original). Start the copy private (omit share/publish/encryption state — mirror the omissions documented in `src/lib/pages/duplicate.ts`). **Refuse encrypted pages** (server has no DEK) and soft-deleted pages.

- [ ] **Step 1: Read the existing helper for the recursive-CTE pattern**

Read `src/lib/pages/duplicate.ts` end-to-end — reuse its `WITH RECURSIVE sub AS (...)` subtree walk, id-remap map, and `tx.execute(rawSql\`...\`)` shape (per CLAUDE.md: `tx.execute()` returns rows directly, cast `as unknown as Row[]`). Also read `src/lib/pages/move.ts` for the workspace-scoping + page-lock conventions and `src/lib/pages/access.ts#requirePageAccess`.

- [ ] **Step 2: Write the failing test**

Model it on the existing duplicate test if one exists (grep `tests/lib/pages` for `duplicate`); otherwise mirror a sibling lib test that uses `tests/helpers/db.ts` (`startPostgres`/`stopPostgres`, TRUNCATE in `beforeEach`). Assert: (a) duplicating a 2-page subtree yields 2 fresh pages in the same workspace with remapped parent pointers and "Copy of <title>" on the root; (b) an encrypted source throws; (c) a soft-deleted source throws; (d) content jsonb is copied verbatim.

Run: `source ~/.zshenv && pnpm vitest run tests/lib/pages/duplicate-owned.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `duplicateOwnedPage`**

```ts
type Args = { sourcePageId: string; workspaceId: string; actorUserId: string };

export async function duplicateOwnedPage(
  db: PostgresJsDatabase<typeof schema>,
  { sourcePageId, workspaceId, actorUserId }: Args,
): Promise<string> {
  // 1. load root scoped to workspaceId; throw if missing | encrypted | deletedAt != null
  // 2. WITH RECURSIVE subtree walk (reuse duplicate.ts CTE)
  // 3. id-remap map; insert copies; root keeps source.parentId, title => 'Copy of ' + title
  // 4. return new root id
}
```

Keep the helper pure + db-injected (CLAUDE.md convention) so it unit-tests without HTTP.

- [ ] **Step 4: Add the route**

`src/app/api/pages/[pageId]/duplicate/route.ts` — `POST`, mirror the structure of `move/route.ts`: `requirePageAccess(pageId, 'editor')`, call `duplicateOwnedPage`, return `NextResponse.json({ id: newRootId }, { status: 201 })`, map `HttpError`/`ZodError` the same way. No request body needed.

- [ ] **Step 5: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/pages/duplicate-owned.test.ts && pnpm lint && pnpm typecheck` (Docker must be up: `colima start` if needed).
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pages/duplicate-owned.ts src/app/api/pages/\[pageId\]/duplicate/route.ts tests/lib/pages/duplicate-owned.test.ts
git commit -m "feat(pages): authenticated in-workspace page duplicate (lib + route) — refs #76"
```

---

### Task 5: Add the four missing page `…` menu actions (#76)

**Files:**
- Modify: `src/components/page-menu.tsx`
- Test: `tests/components/page-menu-actions.test.tsx` (create)

Add four actions to the menu (built on Task 1's `ITEM_CLASS` + icons): **Copy link**, **Duplicate page**, **Move to…** (reparent), **Move to trash** (delete). Group them after the export/import block with a `border-t` divider. Each fires against the backend from the Architecture map:

| Action | Backend | Status |
|---|---|---|
| Copy link | `navigator.clipboard.writeText(`${origin}/pages/${pageId}`)` | client-only |
| Duplicate page | `POST /api/pages/${pageId}/duplicate` (Task 4) | new |
| Move to… | `POST /api/pages/${pageId}/move` `{ newParentId }` | exists |
| Move to trash | `DELETE /api/pages/${pageId}` (`softDeletePage`) | exists |

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageMenu } from '@/components/page-menu';

vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));
afterEach(cleanup);

describe('<PageMenu> new actions', () => {
  it('renders Duplicate, Move to, Move to trash, and Copy link', async () => {
    render(<PageMenu pageId="11111111-1111-1111-1111-111111111111" />);
    screen.getByRole('button', { name: 'Page menu' }).click();
    expect(await screen.findByRole('button', { name: /duplicate page/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /move to trash/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /move to/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/page-menu-actions.test.tsx`
Expected: FAIL — the four buttons don't exist yet.

- [ ] **Step 3: Implement the actions**

Add icons to the existing lucide import: `Copy` (Copy link), `CopyPlus` (Duplicate page), `FolderInput` (Move to…), `Trash2` (Move to trash). Add handlers inside the component:

```tsx
function copyInternalLink() {
  const url = `${window.location.origin}/pages/${pageId}`;
  void navigator.clipboard.writeText(url).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); });
}
async function duplicate() {
  const res = await fetch(`/api/pages/${pageId}/duplicate`, { method: 'POST' });
  if (!res.ok) return;
  const { id } = (await res.json()) as { id: string };
  window.location.href = `/pages/${id}`; // navigate to the copy (use a typed Route helper if the file already imports one)
}
async function moveToTrash() {
  if (!window.confirm(t('pageMenu.confirmTrash'))) return;
  const res = await fetch(`/api/pages/${pageId}`, { method: 'DELETE' });
  if (res.ok) window.location.href = '/';
}
```

For **Move to…**: open a page-picker to choose the new parent, then `POST /api/pages/${pageId}/move { newParentId }`. **Reuse the existing page picker** — `openPagePicker` in `src/components/editor/slash-extension.ts` wraps `fetchPages` + `PageLinkList` (`src/components/editor/page-link-list.tsx`). It is not exported; the cleanest path is to render `PageLinkList` directly in a small inline popover here (the slash one is tippy-bound to a ProseMirror editor and not reusable as-is). If a self-contained picker is more than ~30 lines, **stop and FLAG it as a follow-up sub-task** (`#76 Move-to picker`) and ship the other three actions in this commit — wiring the move endpoint is trivial; the *picker UX* is the only unknown. The picker must also allow "Move to top level" (`newParentId: null`).

All four buttons use `ITEM_CLASS` (≥44px). i18n keys (all three locale files): `pageMenu.copyLink`, `pageMenu.linkCopied`, `pageMenu.duplicate`, `pageMenu.moveTo`, `pageMenu.moveToTrash`, `pageMenu.confirmTrash`, plus (if shipped) `pageMenu.moveToTopLevel`. Add `const [linkCopied, setLinkCopied] = useState(false);`.

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/page-menu-actions.test.tsx tests/components/page-menu-icons.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/page-menu.tsx tests/components/page-menu-actions.test.tsx messages/en.json messages/es.json messages/ar.json
git commit -m "feat(page-menu): add Copy link, Duplicate, Move to, Move to trash actions — Closes #76"
```

---

### Task 6: Slash-menu items get a leading icon (#79)

**Files:**
- Modify: `src/components/editor/slash-menu.tsx`
- Modify: `src/components/editor/slash-extension.ts`
- Test: `tests/components/editor/slash-menu-icons.test.tsx` (create)

The slash menu renders title + description text per command (`src/components/editor/slash-menu.tsx` L80–100) with no icon. The command list lives as `items: SlashItem[]` in `slash-extension.ts` (L238–542). Extend `SlashItem` with an optional `icon` and render it.

- [ ] **Step 1: Extend the `SlashItem` type + render an icon slot**

In `slash-menu.tsx`, change the type and the row markup:

```tsx
import type { LucideIcon } from 'lucide-react';

export type SlashItem = {
  title: string;
  description: string;
  command: (editor: Editor) => void;
  icon?: LucideIcon;
};
```

Inside the option button, render the icon to the left of the title/description stack:

```tsx
<button type="button" tabIndex={-1} onClick={() => command(item)} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent ${i === index ? 'bg-accent' : ''}`}>
  {item.icon ? <item.icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" /> : <span aria-hidden="true" className="h-4 w-4 shrink-0" />}
  <span className="min-w-0">
    <span className="block font-medium">{item.title}</span>
    <span className="block text-xs text-muted-foreground">{item.description}</span>
  </span>
</button>
```

Keep the existing `role="listbox"`/`role="option"`/`aria-activedescendant` structure exactly — it's load-bearing for SR users (the menu is never DOM-focused; TipTap forwards keys). The fallback empty `<span>` keeps titles aligned when an item has no icon.

- [ ] **Step 2: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { Heading1 } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { SlashMenu } from '@/components/editor/slash-menu';

afterEach(cleanup);

describe('<SlashMenu> icons', () => {
  it('renders the item icon when provided', () => {
    const { container } = render(
      <SlashMenu items={[{ title: 'Heading 1', description: 'x', command: () => {}, icon: Heading1 }]} command={() => {}} />,
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
```

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/slash-menu-icons.test.tsx`
Expected: this passes once Step 1 lands; if you wrote it first it fails on the missing `icon` prop / no svg.

- [ ] **Step 3: Assign an icon to every command in `slash-extension.ts`**

Add an `icon:` field to each entry in the `items` array (and to `pdfSlashItem`, and inside `toSlashItem` so the footnote/citation/datetime entries get one — extend `CitationSlashEntry` with an optional `icon` and pass it through `toSlashItem`). Suggested lucide mapping (all from `lucide-react`):

- Heading 1/2/3 → `Heading1` / `Heading2` / `Heading3`
- Bullet list → `List`; Numbered list → `ListOrdered`; Task list → `ListChecks`
- Quote → `Quote`; Code → `Code`; Divider → `Minus`; Callout → `Info`
- Toggle → `ChevronRight`; Columns → `Columns2`; Table → `Table`
- Image → `Image`; File → `Paperclip`; Embed → `Code2`; Bookmark → `Bookmark`
- Button → `MousePointerClick`; Video → `Video`; Audio → `Music`
- Equation → `Sigma`; Synced block → `RefreshCw`; Mermaid → `Workflow`
- PlantUML → `Network`; drawio → `PenTool`; Image gallery → `Images`
- PDF → `FileText`; Footnote → `Asterisk`; Citation → `Quote`; Date/time → `CalendarClock`
- Flashcard → `Layers`; Table of contents → `ListTree`; Database → `Database`; Page embed → `FileSymlink`

(If any name isn't exported by the installed `lucide-react`, substitute the nearest exported icon — `pnpm typecheck` will catch a bad import.)

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/slash-menu-icons.test.tsx tests/components/editor/pdf-slash.test.ts tests/components/editor/citation-slash.test.ts tests/components/editor/datetime-slash.test.ts && pnpm lint && pnpm typecheck`
Expected: PASS — the existing slash-entry tests must still pass (they probe `title`/`description`/`run`, which are unchanged). No new strings here (titles/descriptions already exist; this task is icons only — i18n of slash titles is out of scope for #79).

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/slash-menu.tsx src/components/editor/slash-extension.ts tests/components/editor/slash-menu-icons.test.tsx
git commit -m "fix(editor): add leading icon to every slash command — Closes #79"
```

---

### Task 7: Make the outline panel space-efficient (#80)

**Files:**
- Modify: `src/components/editor/outline-panel.tsx`
- Modify: `src/components/editor/editor.tsx` (layout around L519–527)
- Test: `tests/components/editor/outline-panel.test.tsx` (create)

The outline currently renders as a persistent `w-56` (`14rem`) right column inside `flex gap-4` (`outline-panel.tsx` L31; `editor.tsx` L519–527) even when a page has two headings, eating editor width. It is already toggled by the "Outline" button (`editor.tsx` L506–517, `outlineOpen` state) and `onClose`. **Decision: make it a narrow overlay flyout** rather than an in-flow column — when open it floats over the right edge (sticky, `absolute`/`fixed` positioned, ~`w-56`) instead of shrinking the editor, so the editor body keeps full width and few headings don't waste a column. This is the lowest-risk space win and needs no new persistence (the toggle already exists; no per-user pref API exists for the outline, so don't invent one).

- [ ] **Step 1: Write the failing test (structure/width assertion)**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutlinePanel } from '@/components/editor/outline-panel';

vi.mock('@/lib/editor/headings', () => ({ collectHeadings: () => [{ id: 'h1', level: 1, text: 'Intro' }] }));

afterEach(cleanup);

const fakeEditor = {
  state: { doc: { toJSON: () => ({}) } },
  view: { dom: document.createElement('div') },
  on: () => {},
  off: () => {},
} as unknown as import('@tiptap/react').Editor;

describe('<OutlinePanel> as flyout', () => {
  it('renders an overlay aside that does not consume layout flow (absolute/fixed positioned)', () => {
    render(<OutlinePanel editor={fakeEditor} onClose={() => {}} />);
    const aside = screen.getByRole('complementary', { name: /outline/i });
    expect(aside.className).toMatch(/absolute|fixed/);
  });
});
```

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/outline-panel.test.tsx`
Expected: FAIL — today the `<aside>` is `sticky` in-flow, not `absolute`/`fixed`.

- [ ] **Step 2: Convert the panel to an overlay flyout**

In `outline-panel.tsx`, change the `<aside>` classes from `sticky top-0 max-h-screen w-56 shrink-0 overflow-y-auto border-s p-3 text-sm` to an overlay surface, e.g.:

```tsx
className="absolute end-0 top-0 z-20 max-h-screen w-56 overflow-y-auto rounded-md border bg-popover p-3 text-sm shadow-md"
```

Keep the header (Outline label + `onClose` ✕ button), the empty state, and the heading list logic untouched. Make the ✕ close button clear the touch-target gate: give it `min-h-11 min-w-11` (or wrap the glyph) and an i18n'd `aria-label` via `useT()` → `outline.hide` (it currently hardcodes `aria-label="Hide outline"` — route it through i18n; add `outline.title`, `outline.hide`, `outline.empty` to all three locale files).

- [ ] **Step 3: Update the editor layout**

In `editor.tsx` (L519–527): the `<div className="flex gap-4">` no longer needs the outline as a flex child. Make the editor column the sole flow child and render `<OutlinePanel>` as an overlay positioned relative to the outer `relative` wrapper (the component already has `className="relative"` at L474, which anchors `absolute end-0`). So:

```tsx
<div className="flex gap-4">
  <div className="relative min-w-0 flex-1">
    {editor && <DragHandle editor={editor} />}
    <EditorContent editor={editor} />
  </div>
</div>
{editor && outlineOpen && <OutlinePanel editor={editor} onClose={() => setOutlineOpen(false)} />}
```

Confirm the outline still anchors to the top-right of the editor area and overlays rather than reflowing. The "Outline" toggle button (L506–517) and `outlineOpen` state are unchanged.

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/outline-panel.test.tsx && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS, clean build. (Build is run here because `editor.tsx` is a heavy client component touched by the layout change.)

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/outline-panel.tsx src/components/editor/editor.tsx tests/components/editor/outline-panel.test.tsx messages/en.json messages/es.json messages/ar.json
git commit -m "fix(editor): outline panel as space-efficient overlay flyout — Closes #80"
```

---

### Task 8 (REOPENED): Re-confirm the version footer is a link (#15)

> **Diagnose first.** Round-1 commit `0953b60` ("feat(sidebar): link version footer to GitHub release notes — Closes #15") turned the `v{version}` footer into an `<a>` to the release tag. The issue was reopened — figure out *why it didn't hold* before changing anything.

**Files:**
- Inspect/Modify: `src/components/sidebar-footer-nav.tsx`, `src/components/sidebar-content.tsx`
- Test: `tests/components/sidebar-footer-nav.test.tsx` (create or extend)

- [ ] **Step 1: Diagnose why round-1 regressed**

`git -C . show 0953b60` to see exactly what landed. Then read the **current** `src/components/sidebar-footer-nav.tsx` L48–57: today it *does* render an `<a href="https://github.com/jonathanmcohen/cairn/releases/tag/v${version}" target="_blank" rel="noreferrer">v{version}</a>`. Determine the actual regression. Likely candidates, in order:
  1. The link is keyboard/AA-noncompliant (e.g. only `hover:underline`, no persistent affordance, no visible focus ring → reads as plain text to non-hover users). The link text `v{version}` may not be discernible as a link → WCAG 1.4.1 (use of color / no underline).
  2. The hardcoded GitHub URL drifts from the actual repo/release for self-hosters, so the audit re-flagged it as "looks like text, goes nowhere meaningful".
  3. It's the bare version string with no "release notes" affordance/label.

Write a one-line note in the commit body stating the diagnosed cause.

- [ ] **Step 2: Write a test that pins the real requirement**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SidebarFooterNav } from '@/components/sidebar-footer-nav';

afterEach(cleanup);

describe('<SidebarFooterNav> version link', () => {
  it('renders the version as an accessible external link with a discernible name', () => {
    render(<SidebarFooterNav version="9.9.9" />);
    const link = screen.getByRole('link', { name: /9\.9\.9|release notes/i });
    expect(link.getAttribute('href')).toContain('9.9.9');
    expect(link.getAttribute('target')).toBe('_blank');
    // AA: must carry an underline affordance class (not hover-only) + focus ring.
    expect(link.className).toMatch(/underline/);
  });
});
```

If `SidebarFooterNav` pulls in `ReviewDueCounter`/`ThemeToggle` that error under jsdom, mock them at the top of the test.

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-footer-nav.test.tsx`
Expected: FAIL on whichever assertion encodes the diagnosed regression (likely the `underline` affordance, since today it's `hover:underline` only).

- [ ] **Step 3: Fix per the diagnosis**

Most likely: make the link self-evident — persistent `underline` (not hover-only), a visible focus ring (`focus-visible:ring-1 focus-visible:ring-ring`), and an accessible name that says it's the release notes (e.g. `aria-label={t('sidebar.releaseNotes', { version })}` while still showing `v{version}`). Add i18n key `sidebar.releaseNotes` (e.g. `"Release notes for v{version}"`) to all three locale files. Keep `min-h-11` touch target. If the diagnosis is "URL is wrong/drifts", make the base configurable or point at `/releases` generally — but prefer the smallest fix that closes the AA gap.

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-footer-nav.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar-footer-nav.tsx tests/components/sidebar-footer-nav.test.tsx messages/en.json messages/es.json messages/ar.json
git commit -m "fix(sidebar): version footer is a discernible accessible release-notes link — Closes #15"
```

---

### Task 9 (REOPENED): Implement a real drag-to-resize sidebar with persisted width (#42)

> **Diagnose first.** Round-1 commit `0320e1f` ("polish(sidebar): visible boundary border; **defer drag-resize** — Closes #42") only added a boundary border and explicitly **deferred** the actual resize. The issue was reopened because the deferred work is the work. This time **actually implement drag-resize with persisted width** — or, if there's a hard blocker, document a clear decision in the commit body. Default to implementing.

**Files:**
- Modify: `src/components/sidebar.tsx`
- Possibly create: `src/components/sidebar-resize-handle.tsx` (client component; `sidebar.tsx` is a server component)
- Test: `tests/components/sidebar-resize-handle.test.tsx` (create)

`src/components/sidebar.tsx` is an async **server** component rendering `<aside ... className="hidden h-screen w-64 shrink-0 ...">`. The fixed `w-64` is the column width. A drag handle needs client-side state, so introduce a small `'use client'` resize-handle component and let it drive the width via a CSS variable / inline style on the aside, persisting to `localStorage` (no schema change; per CLAUDE.md a user-pref table would be heavier than warranted for a viewport preference).

- [ ] **Step 1: Diagnose + decide**

`git -C . show 0320e1f` to confirm it only added the border + deferred. Decision for this round: **implement** drag-resize, persist to `localStorage` key `cairn:sidebar-width` (clamp 200–480px), default 256px (= `w-64`). Note this decision in the commit body. (Rationale for localStorage over a DB user-pref: it's a device/viewport preference, instant, and needs no migration — consistent with the existing client-pref patterns.)

- [ ] **Step 2: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SidebarResizeHandle } from '@/components/sidebar-resize-handle';

afterEach(() => { cleanup(); localStorage.clear(); });

describe('<SidebarResizeHandle>', () => {
  it('is a keyboard-operable separator that persists width on arrow keys', () => {
    render(<SidebarResizeHandle storageKey="cairn:sidebar-width" />);
    const handle = screen.getByRole('separator', { name: /resize sidebar/i });
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(localStorage.getItem('cairn:sidebar-width')).toBeTruthy();
  });
});
```

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-resize-handle.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handle**

`SidebarResizeHandle` (`'use client'`):
- Renders a thin vertical grabber positioned on the aside's right edge: `role="separator"`, `aria-orientation="vertical"`, `aria-label={t('sidebar.resize')}`, `aria-valuenow/min/max` reflecting current width, `tabIndex={0}`. Make the hit area ≥44px wide for pointer/touch even though the visible line is ~`w-1` (use a wider transparent padding zone) — touch-target gate.
- Pointer: `onPointerDown` captures the pointer and tracks `pointermove` to set width (clamp 200–480), `onPointerUp` releases + persists.
- Keyboard: ArrowLeft/Right adjust by 16px and persist; Home/End jump to min/max.
- On mount, read `localStorage[storageKey]` and apply. Drive width by setting a CSS custom property on the sidebar root (e.g. `document.documentElement.style.setProperty('--cairn-sidebar-w', \`${w}px\`)`), and have the aside consume it.

In `sidebar.tsx`, switch the aside from the static `w-64` to a width driven by that variable with a fallback, e.g. `style={{ width: 'var(--cairn-sidebar-w, 16rem)' }}` and render `<SidebarResizeHandle storageKey="cairn:sidebar-width" />` as a sibling/child positioned on the right edge (the aside is `md:flex` only, so the handle should be `hidden md:block` too — resize is a desktop affordance; mobile uses the drawer). Keep `shrink-0` and the existing border.

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-resize-handle.test.tsx && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS, clean build (server/client boundary must hold — the handle is `'use client'`, `sidebar.tsx` stays server).

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar.tsx src/components/sidebar-resize-handle.tsx tests/components/sidebar-resize-handle.test.tsx messages/en.json messages/es.json messages/ar.json
git commit -m "feat(sidebar): drag + keyboard resize with localStorage-persisted width — Closes #42"
```

---

### Task 10 (REOPENED): Confirm Sign out renders visually separated (#44)

> **Diagnose first.** Round-1 commit `459c8ac` added a divider above the Sign out row (it also closed #45/#14). The issue was reopened — verify the separation actually *renders* and reads as separated, then strengthen it if the divider is too subtle.

**Files:**
- Inspect/Modify: `src/components/sidebar-footer-nav.tsx`
- Test: `tests/components/sidebar-footer-nav.test.tsx` (extend the file from Task 8)

- [ ] **Step 1: Diagnose**

`git -C . show 459c8ac`, then read current `src/components/sidebar-footer-nav.tsx` L40–47: the Sign out form sits in a row with class `mt-2 flex items-center gap-2 border-t border-border pt-2`. So a top border + spacing *is* present. Determine the reopen reason — likely candidates:
  1. The `border-t border-border` is too low-contrast against `bg-card` to read as a separator (AA non-text contrast 1.4.11 — needs ≥3:1 against adjacent surfaces, or a clearer gap).
  2. The Sign out button is `variant="ghost"` and visually identical to the nav links above it, so it doesn't read as a distinct destructive/account action despite the divider.
  3. The divider is present but the ThemeToggle sharing the row muddies the grouping.

Note the diagnosis in the commit body.

- [ ] **Step 2: Extend the test**

Add to `tests/components/sidebar-footer-nav.test.tsx`:

```tsx
it('renders the Sign out control inside a visually separated group', () => {
  render(<SidebarFooterNav version="1.0.0" />);
  const signOut = screen.getByRole('button', { name: /sign out/i });
  // The sign-out group must carry a separator border (the divider that makes it read as separated).
  const group = signOut.closest('div');
  expect(group?.className).toMatch(/border-t/);
});
```

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-footer-nav.test.tsx`
Expected: this passes if the divider survives; if the diagnosis is "too subtle", encode the stronger requirement (e.g. a dedicated divider element / increased gap) so the test fails until fixed.

- [ ] **Step 3: Strengthen the separation per the diagnosis**

Smallest fix that closes the reopen: bump the divider to a clearly visible separator (e.g. a full-bleed `-mx-3` `border-t` with more `mt-3 pt-3` breathing room), and i18n the "Sign out" label (`sidebar.signOut`) if it's still a literal. If the diagnosis is "looks like a nav link", give Sign out a subtly distinct treatment (e.g. `text-muted-foreground` vs the `text-foreground` nav links, or a leading `LogOut` lucide icon) while keeping `min-h-11`. Add `sidebar.signOut` to all three locale files. Do not reintroduce #45/#14 regressions (Settings entry, nav balance must stay).

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-footer-nav.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar-footer-nav.tsx tests/components/sidebar-footer-nav.test.tsx messages/en.json messages/es.json messages/ar.json
git commit -m "fix(sidebar): sign-out renders clearly separated from nav group — Closes #44"
```

---

## Self-Review

- **Coverage:** #75 (Task 1), #77 (Task 2), #78 (Task 3), #76 backend (Task 4) + UI (Task 5), #79 (Task 6), #80 (Task 7), #15 (Task 8), #42 (Task 9), #44 (Task 10). All nine issues mapped. ✓
- **#76 backend gap surfaced:** Delete (exists), Move-to (exists), Copy-link (no backend needed) all reuse existing endpoints; **Duplicate page is the only action lacking a backend** — Task 4 builds `duplicateOwnedPage` + `/api/pages/[pageId]/duplicate` as a prerequisite, and the Move-to *picker UX* carries an explicit "stop and flag as follow-up if >~30 lines" off-ramp. ✓
- **Task ordering:** #77 before #78 (avatar markup lands before the radix rewrite that touches the same file); #76 backend (Task 4) before #76 UI (Task 5); Task 8 creates the sidebar-footer test file that Task 10 extends. ✓
- **Strict touch-target gate honored:** every new interactive row/handle specifies `min-h-11` (or an explicit ≥44px hit zone for the thin resize handle). ✓
- **i18n:** every new visible string adds a key to `messages/{en,es,ar}.json`; client components use `useT()`. Slash-command titles (#79) are pre-existing and out of scope for i18n in this pass (noted in Task 6). ✓
- **Reopened tasks each start with a "diagnose why round-1 didn't hold" step** referencing the round-1 commit. ✓
- **Per-task commit with `Closes #NN`** (Task 4 uses `refs #76` since it's the backend prerequisite; Task 5 carries `Closes #76`). Lint/typecheck gate every task; `pnpm build` added where a heavy client component / server-client boundary is touched (Tasks 5/7/9 build; 7 + 9 explicitly). ✓
- **No `git push`** — controller/human pushes (CLAUDE.md). ✓

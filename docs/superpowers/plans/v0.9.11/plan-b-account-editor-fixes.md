# v0.9.11 Plan B — Account + editor fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax: failing test → red → impl → green → commit.
>
> ⛔ HOLD — this is plan-only. No code until explicit GO. Branch `patches/v0.9.11` (already checked out). Every shell command MUST be prefixed with `source ~/.zshenv && ` (the Bash tool does not auto-source it; Homebrew/node/pnpm/docker are off-PATH otherwise).

## Goal

Fix the two genuine P1 UI bugs scoped to v0.9.11 Plan B:

- **#126** — the "Display name" label renders twice on `/settings/account/profile` (once as the page's `<dt>`, once as the embedded `ProfileForm`'s `<label>`). Drop the redundant page `<dt>` and keep the form's accessible `<label>` (it is `htmlFor`-bound to the input — removing it would break the input's accessible name).
- **#127** — the bubble-menu text-color control hard-codes a single red (`#dc2626`) and toggles it with no picker; the highlight control hard-codes one amber. Replace both single-color toggles with a small swatch popover (a 6-color palette + a "remove" action for each of text color and highlight), using the repo's existing Radix `Popover` primitive. The TipTap `Color` + `Highlight` extensions are already installed and registered — only the bubble-menu UI changes.

## Architecture

- **#126** is a one-line deletion in a React Server Component (`profile/page.tsx`). The `<dt className="text-muted-foreground">Display name</dt>` wrapper around the `<ProfileForm>` `<dd>` is the duplicate. After removal the `<dl>` row keeps its `<dt>`/`<dd>` shape by collapsing the Display-name entry into a plain block whose only child is `<ProfileForm>` (the form supplies its own labelled field). The hardcoded English `Display name` literal in `page.tsx:49` is also exactly the kind of string the i18n audit flags, so deleting it removes a latent audit finding too.

- **#127** introduces one new client component, `EditorColorPopover`, mounted inside `editor-bubble-menu.tsx` in place of the two single-color `<button>`s (the `Palette` text-color button at lines 163–176 and the `Highlighter` highlight button at lines 177–190). It wraps the existing Radix `Popover` (`src/components/ui/popover.tsx` — `Popover`/`PopoverTrigger`/`PopoverContent`, Radix-backed, already portals + animates). The trigger button reuses the bubble-menu `BTN` class string so it keeps `min-h-11 min-w-11` (the 44px WCAG 2.5.5 touch floor enforced by `tests/a11y/mobile-touch-targets.spec.ts`). The popover body is a grid of swatch `<button>`s; each swatch also carries `min-h-11 min-w-11` so popover targets stay ≥44px. Color application stays Yjs-safe: every handler runs a standard `editor.chain().focus().setColor(c) / toggleHighlight({color}) / unsetColor() / unsetHighlight().run()` transaction (the Collaboration extension syncs the mark to Yjs), identical to the current handlers.

- **i18n:** the swatch trigger labels reuse the existing `editor.bubble.color` / `editor.bubble.highlight` / `editor.bubble.clearColor` keys. New keys are added only for the popover section headings and the per-swatch aria-labels. Color names are kept generic and localized (Red/Orange/Yellow/Green/Blue/Purple) so each swatch has a distinct accessible name. New keys land in `messages/en.json`, `messages/es.json`, `messages/ar.json` (the i18n gate requires all three). No raw user-facing English strings — everything routes through `t()`.

## Tech Stack

- Next.js 16 (App Router, React 19, TS strict, Turbopack). `profile/page.tsx` is a Server Component; `EditorBubbleMenu` + the new `EditorColorPopover` are `'use client'`.
- TipTap 3 editor. `@tiptap/extension-color@3.23.6` + `@tiptap/extension-highlight@3.23.6` (`Highlight.configure({ multicolor: true })`) already registered in `src/components/editor/extensions.ts:95-96`.
- Radix UI `Popover` via `src/components/ui/popover.tsx` (`radix-ui` package, `Popover as PopoverPrimitive`).
- i18n: flat-key `messages/{en,es,ar}.json` resolved through `useT()` from `@/lib/i18n/provider`. Gate = `pnpm i18n:check` (`scripts/i18n-audit.ts`) diffing against `i18n-audit.baseline.json`.
- Tests: Vitest 4, `// @vitest-environment jsdom`, `@testing-library/react`. Lint/format = Biome v2.

### Verified current signatures (read before planning)

- `editor-bubble-menu.tsx:31` — `const BTN = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent ... data-[active=true]:bg-accent ...';`
- `editor-bubble-menu.tsx:38-39` — `const TEXT_COLOR = '#dc2626';` / `const HIGHLIGHT_COLOR = '#fde68a';` (both removed by this plan).
- `editor-bubble-menu.tsx:163-176` — text-color `<button>` with `data-active={editor.isActive('textStyle', { color: TEXT_COLOR })}` and a toggle `onClick` calling `setColor` / `unsetColor`.
- `editor-bubble-menu.tsx:177-190` — highlight `<button>` calling `toggleHighlight({ color: HIGHLIGHT_COLOR })` / `unsetHighlight`.
- `editor-bubble-menu.tsx:308-316` — the existing `Eraser` "clear color" button (`unsetColor().unsetHighlight()`) stays as-is.
- `src/components/ui/popover.tsx` exports `{ Popover, PopoverAnchor, PopoverContent, PopoverTrigger }`; `PopoverContent` defaults `align='start' sideOffset={8}`, `className` includes `z-50 w-72 ... bg-popover ...`.
- `profile/page.tsx:48-53` — the duplicate:
  ```tsx
  <div>
    <dt className="text-muted-foreground">Display name</dt>
    <dd>
      <ProfileForm initialName={user?.name ?? ''} />
    </dd>
  </div>
  ```
- `profile-form.tsx:46-48` — kept accessible label: `<label htmlFor={nameId} className="text-muted-foreground text-sm">{t('profile.displayName')}</label>`.
- Existing test files: `tests/components/editor/editor-bubble-menu.test.tsx` (mocks `@tiptap/react/menus` BubbleMenu to render children; mocks `useT` to echo keys; `makeEditor()` chain stub already has `setColor`/`unsetColor`/`toggleHighlight`/`unsetHighlight`), `tests/components/profile-form.test.tsx`.

---

## File structure

```
docs/superpowers/plans/v0.9.11/
  plan-b-account-editor-fixes.md          # this plan

src/
  app/(app)/settings/account/profile/
    page.tsx                              # EDIT (Task 1) — drop duplicate <dt>
  components/editor/
    editor-bubble-menu.tsx                # EDIT (Task 4) — swap 2 single-color buttons for popover
    editor-color-popover.tsx             # NEW (Task 3) — swatch popover component

messages/
  en.json                                 # EDIT (Task 2) — add swatch i18n keys
  es.json                                 # EDIT (Task 2)
  ar.json                                 # EDIT (Task 2)

tests/
  components/
    account-profile-page.test.tsx        # NEW (Task 1) — asserts single "Display name"
  components/editor/
    editor-color-popover.test.tsx        # NEW (Task 3) — swatch popover behavior
    editor-bubble-menu.test.tsx          # EDIT (Task 4) — popover present, single-color toggle gone
```

---

## Task 1 — #126: drop the duplicate "Display name" `<dt>` on the profile page

The page renders `<dt>Display name</dt>` AND the embedded `ProfileForm` renders its own `<label>{t('profile.displayName')}</label>`. Keep the form's label (it is the input's `htmlFor` accessible name; removing it breaks the input). Drop the page `<dt>`.

### 1a. Failing test

`profile/page.tsx` is an async Server Component that hits the DB via `getDb()`/`getAuthContext()`. Rather than render the RSC, assert on the rendered DOM contract through a focused unit that mounts the *same JSX subtree* the page uses for the Display-name row. We test by rendering `<ProfileForm>` (the kept label) and asserting the page no longer adds a second "Display name" node. The cleanest deterministic check is a source-contract test plus a render of the form to prove exactly one label survives.

Create `tests/components/account-profile-page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

import { ProfileForm } from '@/components/account/profile-form';

afterEach(cleanup);

const pageSource = readFileSync(
  fileURLToPath(new URL('../../src/app/(app)/settings/account/profile/page.tsx', import.meta.url)),
  'utf8',
);

describe('#126 Display name label is rendered exactly once', () => {
  it('the page no longer hard-codes a "Display name" <dt>', () => {
    expect(pageSource).not.toContain('>Display name<');
    expect(pageSource).not.toMatch(/<dt[^>]*>Display name<\/dt>/);
  });

  it('the kept accessible label comes from ProfileForm and is bound to the input', () => {
    render(<ProfileForm initialName="x" />);
    const labels = screen.getAllByText('Display name');
    expect(labels).toHaveLength(1);
    // The label is the input's accessible name (htmlFor binding intact).
    expect(screen.getByLabelText('Display name')).toBeTruthy();
  });
});
```

### 1b. Run it — expect RED

```
source ~/.zshenv && pnpm vitest run tests/components/account-profile-page.test.tsx
```
Expected failure: first assertion fails because `page.tsx:49` still contains `<dt className="text-muted-foreground">Display name</dt>`.

### 1c. Implementation

Edit `src/app/(app)/settings/account/profile/page.tsx`. Replace the Display-name `<div>` (lines 48–53) so the page no longer prints its own label; the `<ProfileForm>` supplies the labelled field. Keep the surrounding `<dl>` and the Email/User-ID rows untouched.

Replace:
```tsx
        <div>
          <dt className="text-muted-foreground">Display name</dt>
          <dd>
            <ProfileForm initialName={user?.name ?? ''} />
          </dd>
        </div>
```
with:
```tsx
        <div>
          {/* #126 — the label lives inside <ProfileForm> (htmlFor-bound to the
              input). A page-level <dt> duplicated it visually; dropped. */}
          <dd>
            <ProfileForm initialName={user?.name ?? ''} />
          </dd>
        </div>
```

### 1d. Run it — expect GREEN

```
source ~/.zshenv && pnpm vitest run tests/components/account-profile-page.test.tsx
```
Both tests pass.

### 1e. Commit

```
source ~/.zshenv && git add src/app/'(app)'/settings/account/profile/page.tsx tests/components/account-profile-page.test.tsx
source ~/.zshenv && git commit -m "fix(account): remove duplicate Display name label on profile page (#126)"
```

---

## Task 2 — #127 i18n: add swatch popover keys to en/es/ar

The popover needs section headings ("Text color" / "Highlight" already exist as `editor.bubble.color` / `editor.bubble.highlight`, reused as headings) plus per-swatch aria-labels and the two "remove" actions. Add new keys for the six color names and the per-section remove labels. All three locale files must stay key-aligned (the i18n gate compares key sets).

### 2a. Failing test

Create the i18n key-presence assertion inside `tests/components/editor/editor-color-popover.test.tsx` is built in Task 3; here add a dedicated locale-parity test so it can be committed independently.

Create `tests/components/editor/editor-color-swatch-i18n.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import ar from '@/../messages/ar.json' with { type: 'json' };
import en from '@/../messages/en.json' with { type: 'json' };
import es from '@/../messages/es.json' with { type: 'json' };

const NEW_KEYS = [
  'editor.color.swatch.red',
  'editor.color.swatch.orange',
  'editor.color.swatch.yellow',
  'editor.color.swatch.green',
  'editor.color.swatch.blue',
  'editor.color.swatch.purple',
  'editor.color.removeText',
  'editor.color.removeHighlight',
] as const;

describe('#127 swatch popover i18n keys', () => {
  for (const locale of [
    ['en', en],
    ['es', es],
    ['ar', ar],
  ] as const) {
    const [name, messages] = locale;
    it(`${name} defines every swatch key with non-empty copy`, () => {
      for (const key of NEW_KEYS) {
        const value = (messages as Record<string, string>)[key];
        expect(value, `${name} missing ${key}`).toBeTruthy();
        expect(value.trim().length).toBeGreaterThan(0);
      }
    });
  }
});
```

### 2b. Run it — expect RED

```
source ~/.zshenv && pnpm vitest run tests/components/editor/editor-color-swatch-i18n.test.ts
```
Expected failure: keys absent in all three files.

### 2c. Implementation

Add these keys to each locale file (place them alongside the existing `editor.bubble.*` / `editor.color.*` block; keep files sorted if the file is sorted — check with the editor and let Biome reflow).

`messages/en.json`:
```json
  "editor.color.swatch.red": "Red",
  "editor.color.swatch.orange": "Orange",
  "editor.color.swatch.yellow": "Yellow",
  "editor.color.swatch.green": "Green",
  "editor.color.swatch.blue": "Blue",
  "editor.color.swatch.purple": "Purple",
  "editor.color.removeText": "Remove text color",
  "editor.color.removeHighlight": "Remove highlight",
```

`messages/es.json`:
```json
  "editor.color.swatch.red": "Rojo",
  "editor.color.swatch.orange": "Naranja",
  "editor.color.swatch.yellow": "Amarillo",
  "editor.color.swatch.green": "Verde",
  "editor.color.swatch.blue": "Azul",
  "editor.color.swatch.purple": "Morado",
  "editor.color.removeText": "Quitar color de texto",
  "editor.color.removeHighlight": "Quitar resaltado",
```

`messages/ar.json`:
```json
  "editor.color.swatch.red": "أحمر",
  "editor.color.swatch.orange": "برتقالي",
  "editor.color.swatch.yellow": "أصفر",
  "editor.color.swatch.green": "أخضر",
  "editor.color.swatch.blue": "أزرق",
  "editor.color.swatch.purple": "بنفسجي",
  "editor.color.removeText": "إزالة لون النص",
  "editor.color.removeHighlight": "إزالة التمييز",
```

### 2d. Run it — expect GREEN

```
source ~/.zshenv && pnpm vitest run tests/components/editor/editor-color-swatch-i18n.test.ts
```

Also confirm the i18n audit baseline is unchanged (new `t()` keys add no new raw-string findings):
```
source ~/.zshenv && pnpm i18n:check
```

### 2e. Commit

```
source ~/.zshenv && git add messages/en.json messages/es.json messages/ar.json tests/components/editor/editor-color-swatch-i18n.test.ts
source ~/.zshenv && git commit -m "i18n(editor): add color/highlight swatch labels en/es/ar (#127)"
```

---

## Task 3 — #127: build the `EditorColorPopover` component (TDD)

A self-contained client component owning the swatch palette for both text color and highlight, wrapping the repo's Radix `Popover`. It receives the `editor` and applies marks via standard chains. The trigger keeps `min-h-11 min-w-11`; every swatch is ≥44px.

### 3a. Failing test

Create `tests/components/editor/editor-color-popover.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorColorPopover } from '@/components/editor/editor-color-popover';

afterEach(cleanup);

// Echo i18n keys as their accessible names.
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

function makeEditor() {
  const chain = {
    focus: () => chain,
    setColor: vi.fn(() => chain),
    unsetColor: vi.fn(() => chain),
    toggleHighlight: vi.fn(() => chain),
    setHighlight: vi.fn(() => chain),
    unsetHighlight: vi.fn(() => chain),
    run: vi.fn(() => true),
  };
  return {
    chain: () => chain,
    isActive: () => false,
    getAttributes: () => ({}),
    __chain: chain,
  } as never;
}

function chainOf(editor: unknown) {
  return (editor as { __chain: Record<string, ReturnType<typeof vi.fn>> }).__chain;
}

describe('<EditorColorPopover>', () => {
  it('renders a ≥44px trigger labelled by editor.bubble.color', () => {
    render(<EditorColorPopover editor={makeEditor()} />);
    const trigger = screen.getByRole('button', { name: 'editor.bubble.color' });
    expect(trigger.className).toContain('min-h-11');
    expect(trigger.className).toContain('min-w-11');
  });

  it('opening the popover reveals labelled text + highlight swatches and removes', () => {
    render(<EditorColorPopover editor={makeEditor()} />);
    fireEvent.click(screen.getByRole('button', { name: 'editor.bubble.color' }));
    // Color names are reused for both sections, so each appears twice (text + highlight).
    expect(screen.getAllByRole('button', { name: 'editor.color.swatch.red' }).length).toBe(2);
    expect(screen.getByRole('button', { name: 'editor.color.removeText' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'editor.color.removeHighlight' })).toBeTruthy();
  });

  it('every swatch button keeps the 44px touch floor', () => {
    render(<EditorColorPopover editor={makeEditor()} />);
    fireEvent.click(screen.getByRole('button', { name: 'editor.bubble.color' }));
    for (const btn of screen.getAllByRole('button', { name: 'editor.color.swatch.blue' })) {
      expect(btn.className).toContain('min-h-11');
      expect(btn.className).toContain('min-w-11');
    }
  });

  it('a text swatch calls setColor with that hex', () => {
    const editor = makeEditor();
    render(<EditorColorPopover editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: 'editor.bubble.color' }));
    const [textRed] = screen.getAllByRole('button', { name: 'editor.color.swatch.red' });
    fireEvent.click(textRed);
    expect(chainOf(editor).setColor).toHaveBeenCalledWith('#dc2626');
    expect(chainOf(editor).run).toHaveBeenCalled();
  });

  it('a highlight swatch calls setHighlight with that hex', () => {
    const editor = makeEditor();
    render(<EditorColorPopover editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: 'editor.bubble.color' }));
    const reds = screen.getAllByRole('button', { name: 'editor.color.swatch.red' });
    fireEvent.click(reds[1]); // second section = highlight
    expect(chainOf(editor).setHighlight).toHaveBeenCalledWith({ color: '#fecaca' });
  });

  it('Remove text color calls unsetColor; Remove highlight calls unsetHighlight', () => {
    const editor = makeEditor();
    render(<EditorColorPopover editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: 'editor.bubble.color' }));
    fireEvent.click(screen.getByRole('button', { name: 'editor.color.removeText' }));
    expect(chainOf(editor).unsetColor).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'editor.color.removeHighlight' }));
    expect(chainOf(editor).unsetHighlight).toHaveBeenCalled();
  });
});
```

### 3b. Run it — expect RED

```
source ~/.zshenv && pnpm vitest run tests/components/editor/editor-color-popover.test.tsx
```
Expected failure: module `@/components/editor/editor-color-popover` does not exist.

### 3c. Implementation

Create `src/components/editor/editor-color-popover.tsx`:

```tsx
'use client';

import type { Editor } from '@tiptap/react';
import { Palette } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useT } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

// #127 — small, fixed palette shared by text color and highlight. Text swatches
// use saturated mark hues; highlight swatches use the lighter tint of the same
// name so the two sections stay legible. Each entry carries a localized name key.
type Swatch = { key: string; text: string; highlight: string };

const SWATCHES: Swatch[] = [
  { key: 'editor.color.swatch.red', text: '#dc2626', highlight: '#fecaca' },
  { key: 'editor.color.swatch.orange', text: '#ea580c', highlight: '#fed7aa' },
  { key: 'editor.color.swatch.yellow', text: '#ca8a04', highlight: '#fde68a' },
  { key: 'editor.color.swatch.green', text: '#16a34a', highlight: '#bbf7d0' },
  { key: 'editor.color.swatch.blue', text: '#2563eb', highlight: '#bfdbfe' },
  { key: 'editor.color.swatch.purple', text: '#9333ea', highlight: '#e9d5ff' },
];

// Matches the bubble-menu BTN class so the trigger keeps the 44px touch floor.
const TRIGGER =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring data-[active=true]:bg-accent data-[active=true]:text-accent-foreground';

// Swatch cells: 44px touch floor with a centered color chip.
const SWATCH_BTN =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring';

const REMOVE_BTN =
  'mt-1 inline-flex min-h-11 w-full items-center rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring';

export function EditorColorPopover({ editor }: { editor: Editor }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  // Yjs-safe: each handler is a standard ProseMirror transaction the
  // Collaboration extension syncs to Yjs.
  const applyText = (color: string) => {
    editor.chain().focus().setColor(color).run();
    setOpen(false);
  };
  const applyHighlight = (color: string) => {
    editor.chain().focus().setHighlight({ color }).run();
    setOpen(false);
  };
  const removeText = () => {
    editor.chain().focus().unsetColor().run();
    setOpen(false);
  };
  const removeHighlight = () => {
    editor.chain().focus().unsetHighlight().run();
    setOpen(false);
  };

  const colorActive =
    editor.isActive('textStyle') || editor.isActive('highlight');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={t('editor.bubble.color')}
        title={t('editor.bubble.color')}
        data-active={colorActive}
        className={cn(TRIGGER)}
      >
        <Palette className="size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="flex flex-col gap-2">
          <section aria-label={t('editor.bubble.color')}>
            <p className="mb-1 px-1 text-muted-foreground text-xs">
              {t('editor.bubble.color')}
            </p>
            <div className="grid grid-cols-6 gap-0.5">
              {SWATCHES.map((s) => (
                <button
                  key={`text-${s.key}`}
                  type="button"
                  aria-label={t(s.key)}
                  title={t(s.key)}
                  onClick={() => applyText(s.text)}
                  className={cn(SWATCH_BTN)}
                >
                  <span
                    className="size-5 rounded-full border border-border"
                    style={{ backgroundColor: s.text }}
                    aria-hidden
                  />
                </button>
              ))}
            </div>
            <button type="button" onClick={removeText} className={cn(REMOVE_BTN)}>
              {t('editor.color.removeText')}
            </button>
          </section>
          <section aria-label={t('editor.bubble.highlight')}>
            <p className="mb-1 px-1 text-muted-foreground text-xs">
              {t('editor.bubble.highlight')}
            </p>
            <div className="grid grid-cols-6 gap-0.5">
              {SWATCHES.map((s) => (
                <button
                  key={`hl-${s.key}`}
                  type="button"
                  aria-label={t(s.key)}
                  title={t(s.key)}
                  onClick={() => applyHighlight(s.highlight)}
                  className={cn(SWATCH_BTN)}
                >
                  <span
                    className="size-5 rounded-sm border border-border"
                    style={{ backgroundColor: s.highlight }}
                    aria-hidden
                  />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={removeHighlight}
              className={cn(REMOVE_BTN)}
            >
              {t('editor.color.removeHighlight')}
            </button>
          </section>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

Note: the test stubs both `setHighlight` and `toggleHighlight`; the component uses `setHighlight({ color })` so a swatch always *sets* the chosen color (not toggles off when re-picking). The existing `block-context-menu.tsx` uses `toggleHighlight`; we keep `setHighlight` here because the picker semantics are "apply this color".

### 3d. Run it — expect GREEN

```
source ~/.zshenv && pnpm vitest run tests/components/editor/editor-color-popover.test.tsx
```

### 3e. Commit

```
source ~/.zshenv && git add src/components/editor/editor-color-popover.tsx tests/components/editor/editor-color-popover.test.tsx
source ~/.zshenv && git commit -m "feat(editor): add color/highlight swatch popover component (#127)"
```

---

## Task 4 — #127: wire the popover into the bubble menu, remove single-color toggles (TDD)

Replace the two hardcoded single-color buttons in `editor-bubble-menu.tsx` with `<EditorColorPopover>` and delete the now-unused `TEXT_COLOR` / `HIGHLIGHT_COLOR` constants. The standalone `Highlighter` button is absorbed into the popover; the `Eraser` clear-color button (lines 308–316) stays.

### 4a. Failing test — extend the existing bubble-menu test

Edit `tests/components/editor/editor-bubble-menu.test.tsx`. The existing `'exposes the expanded #275 controls'` test asserts a `editor.bubble.highlight` standalone button exists — that button is being removed, so update that test and add popover-presence assertions. Mock the popover so the menu test stays a unit (positioning/portal is covered by Task 3).

Add the popover mock near the existing mocks (after the `@/lib/i18n/provider` mock at line 16):
```tsx
// The color popover is unit-tested separately; here assert it's mounted via its
// trigger's accessible name.
vi.mock('@/components/editor/editor-color-popover', () => ({
  EditorColorPopover: () => (
    <button type="button" aria-label="editor.bubble.color">
      color-popover
    </button>
  ),
}));
```

Update the `'exposes the expanded #275 controls'` list — remove `'editor.bubble.highlight'` from the loop (the standalone highlight button is gone; highlight now lives inside the popover):
```tsx
  it('exposes the expanded #275 controls by accessible name', () => {
    render(<EditorBubbleMenu editor={makeEditor()} />);
    for (const name of [
      'editor.bubble.color',
      'editor.bubble.h1',
      'editor.bubble.h2',
      'editor.bubble.h3',
      'editor.bubble.comment',
      'editor.bubble.alignLeft',
      'editor.bubble.alignCenter',
      'editor.bubble.alignRight',
      'editor.bubble.subscript',
      'editor.bubble.superscript',
      'editor.bubble.inlineMath',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });
```

Add a new test asserting the standalone highlight toggle is gone and the popover is mounted:
```tsx
  it('uses the swatch popover for color and drops the single-color highlight toggle', () => {
    render(<EditorBubbleMenu editor={makeEditor()} />);
    // The color popover trigger is present (mocked).
    expect(screen.getByRole('button', { name: 'editor.bubble.color' })).toBeTruthy();
    // The old standalone highlight button no longer renders in the menu body.
    expect(screen.queryByRole('button', { name: 'editor.bubble.highlight' })).toBeNull();
    // The eraser "clear color" affordance is retained.
    expect(screen.getByRole('button', { name: 'editor.bubble.clearColor' })).toBeTruthy();
  });
```

### 4b. Run it — expect RED

```
source ~/.zshenv && pnpm vitest run tests/components/editor/editor-bubble-menu.test.tsx
```
Expected failure: the menu still renders the standalone `editor.bubble.highlight` button (so `queryByRole(... highlight)` is non-null) and there are now two `editor.bubble.color` buttons (the real Palette toggle + the mocked popover) — the new test and the updated list disagree with current source.

### 4c. Implementation

Edit `src/components/editor/editor-bubble-menu.tsx`:

1. Add the import (with the other relative imports, after `EditorLinkPopover`):
```tsx
import { EditorColorPopover } from './editor-color-popover';
```

2. Remove now-unused icon imports `Highlighter` and `Palette` from the `lucide-react` import block (they move into the popover component). Leave all other icons.

3. Delete the constants block at lines 36–39:
```tsx
// #275 — minimal swatch palette. Accent + a couple of common highlight hues keep
// the toolbar compact; "clear" removes the mark.
const TEXT_COLOR = '#dc2626';
const HIGHLIGHT_COLOR = '#fde68a';
```

4. Replace the text-color `<button>` (lines 160–176, the comment block + `Palette` button) AND the highlight `<button>` (lines 177–190) with a single popover mount:
```tsx
          {/* #127 — text color + highlight via a swatch popover (replaces the
              former single-hardcoded-color toggles). */}
          <EditorColorPopover editor={editor} />
```
   Keep the `{SEP}` separators around it intact (one before, one after).

The `Eraser` clear-color button (lines 308–316) and `RemoveFormatting` button stay unchanged.

### 4d. Run it — expect GREEN

```
source ~/.zshenv && pnpm vitest run tests/components/editor/editor-bubble-menu.test.tsx
```

### 4e. Commit

```
source ~/.zshenv && git add src/components/editor/editor-bubble-menu.tsx tests/components/editor/editor-bubble-menu.test.tsx
source ~/.zshenv && git commit -m "feat(editor): swap bubble-menu color/highlight toggles for swatch popover (#127)"
```

---

## Gate Task — full verification

Run the complete gate. Every command must pass with the stated evidence before claiming Plan B done. (Per superpowers:verification-before-completion — paste real output, no assertions without evidence.)

```
source ~/.zshenv && pnpm lint
```
Expect: Biome reports **0 errors** (let `biome check --write` reorder imports / drop the unused `Highlighter`/`Palette` imports if it flags them, then re-run clean).

```
source ~/.zshenv && pnpm typecheck
```
Expect: `tsc --noEmit` exits 0 (no unused-const errors for the deleted `TEXT_COLOR`/`HIGHLIGHT_COLOR`, no missing-import errors).

```
source ~/.zshenv && pnpm i18n:check
```
Expect: **no new findings** vs `i18n-audit.baseline.json`. The deleted `<dt>Display name</dt>` removes one latent finding; all popover strings route through `t()`. If the baseline drifts only by the removed `Display name` finding, that is an expected *reduction* — if the audit treats a smaller report as a diff failure, regenerate the baseline with `pnpm i18n:baseline` and commit it in the gate commit; otherwise leave it untouched.

```
source ~/.zshenv && pnpm vitest run
```
Expect: full suite green (needs Docker/Colima up for Testcontainers files; `colima start` first if the daemon is down). Specifically the four touched/added test files pass.

```
source ~/.zshenv && pnpm build
```
Expect: `next build` succeeds (profile page + editor changes compile).

```
source ~/.zshenv && pnpm exec playwright test tests/a11y/mobile-touch-targets.spec.ts
```
Expect: the touch-target a11y gate passes — the popover trigger and every swatch keep `min-h-11 min-w-11` (44px). (Run the broader a11y suite if the project's gate script names a different path; this is the spec that enforces the 44px floor referenced in scope.)

If the i18n baseline needed regeneration:
```
source ~/.zshenv && git add i18n-audit.baseline.json
source ~/.zshenv && git commit -m "chore(i18n): refresh audit baseline after #126 dt removal"
```

**Do NOT push and do NOT open a PR** — the human/controller integrates the branch.

---

## Notes / decisions

- **#126 keep-vs-drop:** dropped the page `<dt>` (a hardcoded English string with no `htmlFor`), kept the form `<label>` because it is the input's accessible name via `htmlFor={nameId}`. Removing the form label instead would orphan the input's a11y name.
- **#127 highlight semantics:** the popover uses `setHighlight({ color })` (apply chosen color) rather than `toggleHighlight`, because a picker's swatch means "make it this color", not "toggle". `setHighlight` is a valid `@tiptap/extension-highlight` command alongside `toggleHighlight`/`unsetHighlight`.
- **Touch floor:** trigger uses the same `min-h-11 min-w-11` class shape as `BTN`; every swatch cell and the two remove buttons carry `min-h-11`, so the `mobile-touch-targets` a11y spec stays green.
- **No migration, no schema, no API changes.** Plan B is UI-only.

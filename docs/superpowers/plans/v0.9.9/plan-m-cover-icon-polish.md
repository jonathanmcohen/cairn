# Plan M — Cover & Icon Polish (v0.9.9 / G8)

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Close the six cover/icon UX findings from the v0.9.8 live audit: demote the cover "Use default" CTA to a secondary text-link (#49/#228), lay gradient swatches out as a clean 4×2 grid (#50/#229), prefill the custom-hex input with the page's current color (#51/#230), make the rendered cover image clickable to re-open the picker (#60/#239), give the icon-picker's category controls accessible tooltips (#52/#231), and ship migration 0063 to backfill legacy harsh-orange covers (`{kind:'color', value:'#ea580c'|'#d97706'}`) to the curated `slate-dusk` preset (#35/#214).

**Architecture:** Covers persist as a jsonb discriminated union in `pages.cover` (`src/lib/pages/cover.ts#PageCover`). The in-flow `CoverPicker` (`src/components/pages/cover-picker.tsx`, client) is the single canonical add/change affordance; it PATCHes `/api/pages/[pageId]/cover` then `router.refresh()`. `CoverBanner` (`src/components/pages/cover-banner.tsx`, server) renders the 200px banner. Both mount in `src/app/(app)/pages/[pageId]/page.tsx`. Curated presets live in `src/lib/pages/cover-presets.ts` (8 gradients + 6 neutrals, default `slate-dusk`). The icon picker (`src/components/icon-picker.tsx`, client) wraps the `emoji-picker-element` web component with Emoji/Upload tab buttons + a Remove control. The legacy harsh-orange swatches (`#ea580c`, `#d97706`) shipped in the original v0.8.0 picker and were dropped from the curated palette but never backfilled on existing rows — migration 0063 fixes the persisted data. Tooltips in this codebase are native `title=` attributes (no Radix tooltip dep); follow that pattern.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript 6 strict · Drizzle ORM + Postgres 16 (migrations applied by `src/server/entrypoint.ts`, `db:generate` does NOT emit data-backfill SQL — hand-write 0063) · Biome v2 (0 errors) · Vitest 4 + Testcontainers v12 (real Postgres; isolate ON, serial forks) · Tailwind v4 + shadcn/ui · i18n en/es/ar via `useT()` (catalogs at `messages/{en,es,ar}.json`).

---

## M1 — Cover "Use default" demoted to secondary text-link (#49/#228)

The "Use default cover" control renders as a full-width primary `<Button className="w-full">` at the top of the Color tab (`cover-picker.tsx:164-171`), reading as the headline CTA and crowding the swatches. Demote it to a muted secondary text-link at the BOTTOM of the Color tab, beside "Remove cover".

**Files:**
- Modify `tests/components/pages/cover-picker.test.tsx`
- Modify `src/components/pages/cover-picker.tsx`

Steps:
- [ ] Add a failing test asserting the "Use default" control is a low-emphasis link, not a primary button, and sits after the swatches. In `tests/components/pages/cover-picker.test.tsx`:
  ```tsx
  it('renders "Use default" as a secondary text-link, not a full-width primary CTA', async () => {
    const user = userEvent.setup();
    render(<CoverPicker pageId="p1" current={{}} />);
    await user.click(screen.getByRole('button', { name: 'Add cover' }));
    const useDefault = screen.getByRole('button', { name: 'Use default cover' });
    // Demoted: link variant, not the primary/full-width CTA it used to be.
    expect(useDefault.className).not.toContain('w-full');
    expect(useDefault).toHaveClass('text-muted-foreground');
    // It now lives at the bottom of the tab, after the gradient swatches.
    const firstGradient = screen.getByRole('button', { name: 'Use Slate dusk cover' });
    expect(firstGradient.compareDocumentPosition(useDefault) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/pages/cover-picker.test.tsx`
- [ ] Implement. In `src/components/pages/cover-picker.tsx`, delete the top primary "Use default" `<Button>` block (lines 164-171) and add a footer row. Replace the trailing `{'kind' in current && (...remove...)}` block (lines 239-243) with a single footer flex row containing both the demoted "Use default" link and the existing "Remove" link:
  ```tsx
  <div className="flex items-center gap-4 border-t pt-3">
    <Button
      type="button"
      variant="link"
      size="sm"
      className="h-auto p-0 text-muted-foreground hover:text-foreground"
      disabled={saving}
      onClick={() => void save({ kind: 'preset', value: DEFAULT_COVER_PRESET_KEY })}
    >
      {t('cover.useDefault')}
    </Button>
    {'kind' in current && (
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-muted-foreground hover:text-foreground"
        disabled={saving}
        onClick={() => void save({})}
      >
        {t('cover.remove')}
      </Button>
    )}
  </div>
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/pages/cover-picker.test.tsx`
- [ ] Commit: `fix(cover): demote "Use default" to a secondary text-link (#228)`

---

## M2 — Gradient swatches as a 4×2 grid (#50/#229)

The gradient swatches render in `grid-cols-7` (`cover-picker.tsx:176`), which awkwardly wraps the 8 curated gradients into a 7+1 layout. Switch to `grid-cols-4` so the 8 gradients form a clean 4×2 block. (Leave the 6 neutrals on their own grid; `grid-cols-3` reads as a tidy 3×2 — adjust to match.)

**Files:**
- Modify `tests/components/pages/cover-picker.test.tsx`
- Modify `src/components/pages/cover-picker.tsx`

Steps:
- [ ] Add a failing test asserting the gradient swatch grid is 4-wide. In `tests/components/pages/cover-picker.test.tsx`:
  ```tsx
  it('lays gradient swatches out in a 4-wide grid (4×2 for 8 gradients)', async () => {
    const user = userEvent.setup();
    render(<CoverPicker pageId="p1" current={{}} />);
    await user.click(screen.getByRole('button', { name: 'Add cover' }));
    const firstGradient = screen.getByRole('button', { name: 'Use Slate dusk cover' });
    const grid = firstGradient.parentElement!;
    expect(grid).toHaveClass('grid-cols-4');
    expect(grid).not.toHaveClass('grid-cols-7');
    // All 8 curated gradients are present.
    expect(grid.querySelectorAll('button')).toHaveLength(8);
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/pages/cover-picker.test.tsx`
- [ ] Implement. In `src/components/pages/cover-picker.tsx`, change the gradient grid container from `grid grid-cols-7 gap-2` (line 176) to `grid grid-cols-4 gap-2`, and the neutral grid container from `grid grid-cols-7 gap-2` (line 194) to `grid grid-cols-3 gap-2`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/pages/cover-picker.test.tsx`
- [ ] Commit: `fix(cover): lay gradient swatches in a 4×2 grid (#229)`

---

## M3 — Custom-hex input prefilled with the current color (#51/#230)

The custom-hex `Input` starts blank (`useState('')`, `cover-picker.tsx:45`), so a user editing an existing `{kind:'color'}` cover must retype the hex from scratch. Seed `customHex` from the current cover when it is a `color` (or resolve the representative `solid` of a `preset`) so the field shows the current value and the contrast preview reflects it immediately.

**Files:**
- Modify `tests/components/pages/cover-picker.test.tsx`
- Modify `src/components/pages/cover-picker.tsx`

Steps:
- [ ] Add failing tests for both seeding cases. In `tests/components/pages/cover-picker.test.tsx`:
  ```tsx
  it('prefills the custom-hex input with the current color cover', async () => {
    const user = userEvent.setup();
    render(<CoverPicker pageId="p1" current={{ kind: 'color', value: '#3366ff' }} />);
    await user.click(screen.getByRole('button', { name: 'Change cover' }));
    expect(screen.getByLabelText('Custom hex')).toHaveValue('#3366ff');
  });

  it('prefills the custom-hex input with the current preset’s representative tone', async () => {
    const user = userEvent.setup();
    render(<CoverPicker pageId="p1" current={{ kind: 'preset', value: 'slate-dusk' }} />);
    await user.click(screen.getByRole('button', { name: 'Change cover' }));
    // slate-dusk.solid === '#1e293b'
    expect(screen.getByLabelText('Custom hex')).toHaveValue('#1e293b');
  });

  it('leaves the custom-hex input blank when there is no cover', async () => {
    const user = userEvent.setup();
    render(<CoverPicker pageId="p1" current={{}} />);
    await user.click(screen.getByRole('button', { name: 'Add cover' }));
    expect(screen.getByLabelText('Custom hex')).toHaveValue('');
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/pages/cover-picker.test.tsx`
- [ ] Implement. In `src/components/pages/cover-picker.tsx`:
  - Import the preset resolver alongside the existing import on line 14:
    ```tsx
    import { COVER_PRESETS, DEFAULT_COVER_PRESET_KEY, getCoverPreset } from '@/lib/pages/cover-presets';
    ```
  - Add a pure helper above the component to derive the seed hex from `current`:
    ```tsx
    function seedHexFromCover(cover: PageCover): string {
      if ('kind' in cover && cover.kind === 'color') return cover.value;
      if ('kind' in cover && cover.kind === 'preset') return getCoverPreset(cover.value)?.solid ?? '';
      return '';
    }
    ```
  - Seed the state on line 45: `const [customHex, setCustomHex] = useState(() => seedHexFromCover(current));`
  - Re-seed when the modal (re)opens so an outside cover change reflects. Extend the existing `useEffect` keyed on `[open]` (lines 51-55) to also set the hex:
    ```tsx
    useEffect(() => {
      if (!open || typeof window === 'undefined') return;
      const computed = getComputedStyle(document.documentElement).getPropertyValue('--foreground');
      setTitleColor(resolveTitleForeground(computed));
      setCustomHex(seedHexFromCover(current));
    }, [open, current]);
    ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/pages/cover-picker.test.tsx`
- [ ] Commit: `fix(cover): prefill custom-hex input with the current cover color (#230)`

---

## M4 — Cover image clickable to edit (#60/#239)

The rendered `CoverBanner` is inert; the only way to change a cover is the separate "Change cover" button below it. Make the banner itself clickable (editors only) so clicking the cover opens the picker. `CoverBanner` is a server component and `CoverPicker` owns the `open` state, so introduce a small client wrapper `EditableCover` that renders the banner inside a button and lifts the picker's `open` state via a controlled prop. Public `/p/[slug]` keeps the bare (non-clickable) `CoverBanner`.

**Files:**
- Create `src/components/pages/editable-cover.tsx`
- Create `tests/components/pages/editable-cover.test.tsx`
- Modify `src/components/pages/cover-picker.tsx`
- Modify `src/app/(app)/pages/[pageId]/page.tsx`

Steps:
- [ ] Make `CoverPicker` accept a controlled-open contract so the wrapper can drive it. Add a failing test in `tests/components/pages/cover-picker.test.tsx`:
  ```tsx
  it('honors a controlled `open` prop and reports close via onOpenChange', async () => {
    const onOpenChange = vi.fn();
    render(
      <CoverPicker pageId="p1" current={{}} open onOpenChange={onOpenChange} hideTrigger />,
    );
    // Dialog is shown without clicking the trigger…
    expect(screen.getByRole('dialog', { name: 'Page cover' })).toBeInTheDocument();
    // …and the trigger button is suppressed.
    expect(screen.queryByRole('button', { name: /cover$/i })).not.toBeInTheDocument();
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/pages/cover-picker.test.tsx`
- [ ] Implement controlled-open in `src/components/pages/cover-picker.tsx`:
  - Extend `CoverPickerProps`:
    ```tsx
    /** Controlled open state. When provided, the picker is driven externally. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Hide the built-in "Add/Change cover" trigger button (controlled mode). */
    hideTrigger?: boolean;
    ```
  - Destructure them and derive effective open/close:
    ```tsx
    export function CoverPicker({
      pageId, current, unsplashKey, onChange,
      open: openProp, onOpenChange, hideTrigger,
    }: CoverPickerProps) {
      const [openState, setOpenState] = useState(false);
      const open = openProp ?? openState;
      const setOpen = (next: boolean) => {
        if (onOpenChange) onOpenChange(next);
        else setOpenState(next);
      };
    ```
  - Replace every `setOpen(true)` / `setOpen(false)` call (trigger onClick, overlay, Escape, `persist`) with the new `setOpen`. Keep `useFocusTrap(open)` keyed on the derived `open`.
  - Wrap the trigger button so it is suppressed in controlled mode: `{!hideTrigger && (<Button …>…</Button>)}`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/pages/cover-picker.test.tsx`
- [ ] Add a failing test for the wrapper. Create `tests/components/pages/editable-cover.test.tsx`:
  ```tsx
  import { render, screen } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { describe, expect, it } from 'vitest';
  import { EditableCover } from '@/components/pages/editable-cover';
  import { I18nProvider } from '@/lib/i18n/provider';

  function wrap(ui: React.ReactNode) {
    return render(<I18nProvider locale="en">{ui}</I18nProvider>);
  }

  describe('EditableCover', () => {
    it('renders the cover inside a labelled edit button and opens the picker on click', async () => {
      const user = userEvent.setup();
      wrap(
        <EditableCover
          pageId="p1"
          cover={{ kind: 'preset', value: 'slate-dusk' }}
          alt="My page"
        />,
      );
      const trigger = screen.getByRole('button', { name: 'Edit cover' });
      expect(trigger).toBeInTheDocument();
      await user.click(trigger);
      expect(screen.getByRole('dialog', { name: 'Page cover' })).toBeInTheDocument();
    });

    it('renders nothing for an empty cover (no banner to click)', () => {
      wrap(<EditableCover pageId="p1" cover={{}} alt="My page" />);
      expect(screen.queryByRole('button', { name: 'Edit cover' })).not.toBeInTheDocument();
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/pages/editable-cover.test.tsx`
- [ ] Add the i18n key `cover.editAria` to all three catalogs. In `messages/en.json` under the `cover` object:
  ```json
  "editAria": "Edit cover"
  ```
  In `messages/es.json`:
  ```json
  "editAria": "Editar portada"
  ```
  In `messages/ar.json`:
  ```json
  "editAria": "تحرير الغلاف"
  ```
- [ ] Implement the wrapper. Create `src/components/pages/editable-cover.tsx`:
  ```tsx
  'use client';

  import { useState } from 'react';
  import { CoverBanner } from '@/components/pages/cover-banner';
  import { CoverPicker } from '@/components/pages/cover-picker';
  import { useT } from '@/lib/i18n/provider';
  import type { PageCover } from '@/lib/pages/cover';

  export type EditableCoverProps = {
    pageId: string;
    cover: PageCover;
    alt?: string;
    unsplashKey?: string;
  };

  /**
   * #239 — wraps the server-rendered cover banner in a full-bleed edit button so
   * clicking the cover opens the same canonical CoverPicker the "Change cover"
   * button drives. Renders nothing when there is no cover (the empty-state path
   * keeps the standalone "Add cover" button below).
   */
  export function EditableCover({ pageId, cover, alt = '', unsplashKey }: EditableCoverProps) {
    const t = useT();
    const [open, setOpen] = useState(false);
    if (!('kind' in cover)) return null;
    return (
      <>
        <button
          type="button"
          aria-label={t('cover.editAria')}
          onClick={() => setOpen(true)}
          className="block w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
        >
          <CoverBanner cover={cover} alt={alt} />
        </button>
        <CoverPicker
          pageId={pageId}
          current={cover}
          unsplashKey={unsplashKey}
          open={open}
          onOpenChange={setOpen}
          hideTrigger
        />
      </>
    );
  }
  ```
  Note: `CoverBanner` (server component) is safe to render from a client component because it has no client-only APIs — it only reads `env()` + `signFileUrl` at render, which run on the server during RSC and are inlined. If the build flags a server-only import, instead pass the already-resolved banner as `children` from the page (RSC) into `EditableCover`. Verify in the build gate.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/pages/editable-cover.test.tsx`
- [ ] Wire into the page. In `src/app/(app)/pages/[pageId]/page.tsx`, replace the standalone `<CoverBanner cover={cover} alt={page.title} />` on line 79 + the editor `CoverPicker` block (lines 85-89) so that:
  - When `canEdit && 'kind' in cover`: render `<EditableCover pageId={page.id} cover={cover} alt={page.title} unsplashKey={unsplashKey} />` (clickable banner; the picker rides inside it).
  - When `canEdit && !('kind' in cover)`: render the standalone `<CoverPicker pageId={page.id} current={cover} unsplashKey={unsplashKey} />` "Add cover" button (no banner to click yet).
  - When `!canEdit`: render the bare `<CoverBanner cover={cover} alt={page.title} />`.
  Add the import `import { EditableCover } from '@/components/pages/editable-cover';`.
  ```tsx
  {canEdit ? (
    'kind' in cover ? (
      <EditableCover
        pageId={page.id}
        cover={cover}
        alt={page.title}
        unsplashKey={unsplashKey}
      />
    ) : (
      <div className="mb-2 flex justify-start">
        <CoverPicker pageId={page.id} current={cover} unsplashKey={unsplashKey} />
      </div>
    )
  ) : (
    <CoverBanner cover={cover} alt={page.title} />
  )}
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/pages/`
- [ ] Commit: `feat(cover): make the rendered cover clickable to edit (#239)`

---

## M5 — Icon-picker category controls get accessible tooltips (#52/#231)

The icon-picker's category controls (the Emoji / Upload tab buttons and the Remove control, `icon-picker.tsx:110-138`) carry no `title` and the Emoji/Upload buttons have no `aria-label` beyond their text — under truncation or for screen-reader users their purpose is ambiguous, and the audit flags missing hover tooltips. Add native `title` tooltips (the codebase's established tooltip mechanism, e.g. `view-switcher.tsx:198`) plus i18n strings. Also wire `useT()` into the picker (it currently hardcodes English: "Emoji", "Upload", "Remove", "Change icon", "Recently used", "Use {r}").

**Files:**
- Modify `tests/components/icon-picker.test.tsx`
- Modify `src/components/icon-picker.tsx`
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json`

Steps:
- [ ] Add a failing test for tooltips + i18n. In `tests/components/icon-picker.test.tsx` (create the `describe` block / file if absent, mirroring `cover-picker.test.tsx` with an `I18nProvider` wrapper):
  ```tsx
  it('gives each category control a hover tooltip + accessible name', async () => {
    const user = userEvent.setup();
    wrap(<IconPicker value={null} onChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Change icon' }));
    const emoji = screen.getByRole('button', { name: 'Emoji' });
    const upload = screen.getByRole('button', { name: 'Upload an image' });
    const remove = screen.getByRole('button', { name: 'Remove icon' });
    expect(emoji).toHaveAttribute('title', 'Browse emoji');
    expect(upload).toHaveAttribute('title', 'Upload a custom image');
    expect(remove).toHaveAttribute('title', 'Remove the current icon');
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/icon-picker.test.tsx`
- [ ] Add the i18n keys to all three catalogs. In `messages/en.json` (new top-level `iconPicker` object):
  ```json
  "iconPicker": {
    "changeAria": "Change icon",
    "emoji": "Emoji",
    "emojiTooltip": "Browse emoji",
    "upload": "Upload an image",
    "uploadTooltip": "Upload a custom image",
    "remove": "Remove icon",
    "removeTooltip": "Remove the current icon",
    "recentlyUsed": "Recently used",
    "useEmoji": "Use {emoji}"
  }
  ```
  In `messages/es.json`:
  ```json
  "iconPicker": {
    "changeAria": "Cambiar icono",
    "emoji": "Emoji",
    "emojiTooltip": "Explorar emojis",
    "upload": "Subir una imagen",
    "uploadTooltip": "Subir una imagen personalizada",
    "remove": "Quitar icono",
    "removeTooltip": "Quitar el icono actual",
    "recentlyUsed": "Usados recientemente",
    "useEmoji": "Usar {emoji}"
  }
  ```
  In `messages/ar.json`:
  ```json
  "iconPicker": {
    "changeAria": "تغيير الأيقونة",
    "emoji": "إيموجي",
    "emojiTooltip": "تصفّح الإيموجي",
    "upload": "رفع صورة",
    "uploadTooltip": "رفع صورة مخصّصة",
    "remove": "إزالة الأيقونة",
    "removeTooltip": "إزالة الأيقونة الحالية",
    "recentlyUsed": "المستخدمة مؤخرًا",
    "useEmoji": "استخدام {emoji}"
  }
  ```
- [ ] Implement. In `src/components/icon-picker.tsx`:
  - Add `import { useT } from '@/lib/i18n/provider';` and `const t = useT();` at the top of the component.
  - Trigger button: `aria-label={t('iconPicker.changeAria')}` (replaces hardcoded `"Change icon"` on line 101).
  - Emoji tab button: add `title={t('iconPicker.emojiTooltip')}` and replace the `Emoji` text node with `{t('iconPicker.emoji')}`.
  - Upload tab button: add `title={t('iconPicker.uploadTooltip')}` and replace the `Upload` text node with `{t('iconPicker.upload')}`.
  - Remove button: add `title={t('iconPicker.removeTooltip')}` and replace the `Remove` text node with `{t('iconPicker.remove')}`.
  - "Recently used" label → `{t('iconPicker.recentlyUsed')}`; recent-swatch `aria-label={t('iconPicker.useEmoji', { emoji: r })}`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/icon-picker.test.tsx`
- [ ] Commit: `fix(icon-picker): add accessible category tooltips + i18n (#231)`

---

## M6 — Migration 0063: legacy orange cover backfill (#35/#214)

The original v0.8.0 cover picker shipped a fixed swatch list including the harsh orange/amber hexes `#ea580c` and `#d97706` (see the v0.8.0 P20 plan, `COLOR_PRESETS`). The curated palette (v0.9.6+) dropped these, but existing rows that picked them still persist `{kind:'color', value:'#ea580c'}` / `{value:'#d97706'}` in `pages.cover`. Backfill those rows (case-insensitive on the hex, including 3-digit shorthands of the same tone) to the curated `slate-dusk` preset so they adopt the design-system look. Idempotent, data-only — no schema change.

**Files:**
- Create `drizzle/migrations/0063_backfill_legacy_orange_covers.sql`
- Create `src/lib/pages/backfill-legacy-cover.ts`
- Create `tests/lib/pages/migration-0063.test.ts`
- Create `tests/lib/pages/backfill-legacy-cover.test.ts`

Steps:
- [ ] Write the pure predicate first (TDD-able without a DB). Add a failing test `tests/lib/pages/backfill-legacy-cover.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { isLegacyOrangeCover, LEGACY_ORANGE_HEXES } from '@/lib/pages/backfill-legacy-cover';

  describe('isLegacyOrangeCover', () => {
    it('matches the legacy orange/amber color covers (case-insensitive)', () => {
      expect(isLegacyOrangeCover({ kind: 'color', value: '#ea580c' })).toBe(true);
      expect(isLegacyOrangeCover({ kind: 'color', value: '#EA580C' })).toBe(true);
      expect(isLegacyOrangeCover({ kind: 'color', value: '#d97706' })).toBe(true);
    });
    it('does not match curated presets, other colors, or empty covers', () => {
      expect(isLegacyOrangeCover({ kind: 'preset', value: 'ember-mute' })).toBe(false);
      expect(isLegacyOrangeCover({ kind: 'color', value: '#3366ff' })).toBe(false);
      expect(isLegacyOrangeCover({})).toBe(false);
    });
    it('exposes the canonical legacy hex list (lowercased)', () => {
      expect(LEGACY_ORANGE_HEXES).toEqual(['#ea580c', '#d97706']);
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/pages/backfill-legacy-cover.test.ts`
- [ ] Implement `src/lib/pages/backfill-legacy-cover.ts`:
  ```ts
  import type { PageCover } from '@/lib/pages/cover';
  import { DEFAULT_COVER_PRESET_KEY } from '@/lib/pages/cover-presets';

  /**
   * #214 — the harsh orange/amber hexes the original v0.8.0 picker offered
   * (dropped from the curated palette in v0.9.6 but never backfilled on
   * existing rows). Lowercased; the migration matches case-insensitively.
   */
  export const LEGACY_ORANGE_HEXES = ['#ea580c', '#d97706'] as const;

  export function isLegacyOrangeCover(cover: PageCover): boolean {
    return (
      'kind' in cover &&
      cover.kind === 'color' &&
      (LEGACY_ORANGE_HEXES as readonly string[]).includes(cover.value.toLowerCase())
    );
  }

  /** The curated preset legacy orange covers are reassigned to. */
  export const LEGACY_ORANGE_REPLACEMENT: PageCover = {
    kind: 'preset',
    value: DEFAULT_COVER_PRESET_KEY,
  };
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/pages/backfill-legacy-cover.test.ts`
- [ ] Hand-write the migration `drizzle/migrations/0063_backfill_legacy_orange_covers.sql`. `db:generate` does not emit data backfills, so author full SQL by hand (matches the "hand-append" convention). Match on the jsonb `kind`+`value`, lower-casing the hex, and rewrite to the `slate-dusk` preset jsonb:
  ```sql
  -- 0063_backfill_legacy_orange_covers.sql
  -- v0.9.9 Plan M / #214 — the original v0.8.0 cover picker offered harsh
  -- orange/amber hex swatches (#ea580c, #d97706). The curated palette dropped
  -- them in v0.9.6 but existing pages.cover rows still persist them. Reassign
  -- any such row to the curated default preset (slate-dusk). Idempotent + data
  -- only — no schema change. Hand-written: db:generate does not emit backfills.
  UPDATE "pages"
  SET "cover" = '{"kind":"preset","value":"slate-dusk"}'::jsonb,
      "updated_at" = now()
  WHERE "cover" ->> 'kind' = 'color'
    AND lower("cover" ->> 'value') IN ('#ea580c', '#d97706');
  ```
  Append a journal entry to `drizzle/migrations/meta/_journal.json` for `0063_backfill_legacy_orange_covers` (next `idx`, current `when` epoch ms, `tag` `0063_backfill_legacy_orange_covers`, `breakpoints: true`) so `runMigrations` picks it up — mirror the existing 0061 entry's shape.
- [ ] Add a failing migration integration test `tests/lib/pages/migration-0063.test.ts` (Testcontainers, mirrors `tests/lib/pages/migration-0018.test.ts`):
  ```ts
  import { sql as rawSql } from 'drizzle-orm';
  import { drizzle } from 'drizzle-orm/postgres-js';
  import postgres from 'postgres';
  import { afterAll, beforeAll, describe, expect, it } from 'vitest';
  import { runMigrations } from '@/db/migrate';
  import * as schema from '@/db/schema';
  import { startPostgres, stopPostgres } from '../../helpers/db';

  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    const uri = await startPostgres();
    await runMigrations(uri);
    sql = postgres(uri);
    db = drizzle(sql, { schema });
  });
  afterAll(async () => {
    await sql.end();
    await stopPostgres();
  });

  describe('migration 0063 — legacy orange cover backfill', () => {
    it('reassigns #ea580c / #d97706 color covers to the slate-dusk preset', async () => {
      const [{ id: workspaceId }] = (await db.execute(rawSql`
        INSERT INTO "workspaces" ("name", "slug") VALUES ('m6', 'm6-${Date.now()}')
        RETURNING "id"
      `)) as unknown as { id: string }[];
      const insertPage = async (cover: string) => {
        const [{ id }] = (await db.execute(rawSql`
          INSERT INTO "pages" ("workspace_id", "title", "cover")
          VALUES (${workspaceId}, 'p', ${cover}::jsonb) RETURNING "id"
        `)) as unknown as { id: string }[];
        return id;
      };
      const orange = await insertPage('{"kind":"color","value":"#ea580c"}');
      const amberUpper = await insertPage('{"kind":"color","value":"#D97706"}');
      const blue = await insertPage('{"kind":"color","value":"#3366ff"}');
      const preset = await insertPage('{"kind":"preset","value":"ember-mute"}');

      // Re-run migrations to apply 0063 against the seeded rows (idempotent).
      await runMigrations(await startPostgres());
      // NOTE: the seed+assert run in one DB; re-running runMigrations on the
      // SAME uri is a no-op after first apply. Instead apply 0063's UPDATE via
      // the journal already executed in beforeAll, then seed BEFORE that — see
      // alternative below if ordering requires seeding pre-migration.

      const coverOf = async (id: string) => {
        const [row] = (await db.execute(rawSql`
          SELECT "cover" FROM "pages" WHERE "id" = ${id}
        `)) as unknown as { cover: unknown }[];
        return row.cover;
      };
      // Legacy oranges → slate-dusk preset (lowercase + uppercase both caught).
      expect(await coverOf(orange)).toEqual({ kind: 'preset', value: 'slate-dusk' });
      expect(await coverOf(amberUpper)).toEqual({ kind: 'preset', value: 'slate-dusk' });
      // Untouched: other color + already-curated preset.
      expect(await coverOf(blue)).toEqual({ kind: 'color', value: '#3366ff' });
      expect(await coverOf(preset)).toEqual({ kind: 'preset', value: 'ember-mute' });
    });
  });
  ```
  Implementation note for the implementer: because `runMigrations` runs in `beforeAll` BEFORE any rows exist, assert the backfill against a freshly-seeded-then-migrated DB. Either (a) seed the legacy rows in `beforeAll` BEFORE calling `runMigrations`, or (b) drop+recreate via a second `startPostgres()` container where you seed first, then `runMigrations`. Prefer (a): in `beforeAll`, open the container, run migrations up to 0062, seed legacy rows, then run 0063 — OR simpler, extract the backfill UPDATE into an exported `backfillLegacyOrangeCovers(db)` in `src/lib/pages/backfill-legacy-cover.ts` and unit-test that directly against seeded rows (no migration ordering puzzle). Adopt the extracted-function approach: add to `backfill-legacy-cover.ts`:
  ```ts
  import { sql } from 'drizzle-orm';
  import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
  import type * as schema from '@/db/schema';

  /** Imperative twin of 0063 for tests + re-runnable maintenance. Idempotent. */
  export async function backfillLegacyOrangeCovers(
    db: PostgresJsDatabase<typeof schema>,
  ): Promise<number> {
    const res = await db.execute(sql`
      UPDATE "pages"
      SET "cover" = '{"kind":"preset","value":"slate-dusk"}'::jsonb,
          "updated_at" = now()
      WHERE "cover" ->> 'kind' = 'color'
        AND lower("cover" ->> 'value') IN ('#ea580c', '#d97706')
    `);
    return (res as unknown as { count: number }).count ?? 0;
  }
  ```
  Then the integration test seeds rows AFTER `runMigrations`, calls `await backfillLegacyOrangeCovers(db)`, and asserts — and separately the test confirms the SQL file `0063_backfill_legacy_orange_covers.sql` exists and contains the same `UPDATE … IN ('#ea580c', '#d97706')` predicate so the migration and the function stay in lockstep:
  ```ts
  it('ships the 0063 migration with the matching predicate', async () => {
    const fs = await import('node:fs');
    const path = new URL('../../../drizzle/migrations/0063_backfill_legacy_orange_covers.sql', import.meta.url);
    const text = fs.readFileSync(path, 'utf8');
    expect(text).toMatch(/UPDATE "pages"/);
    expect(text).toMatch(/'#ea580c'/);
    expect(text).toMatch(/'#d97706'/);
    expect(text).toMatch(/"kind":"preset","value":"slate-dusk"/);
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/pages/migration-0063.test.ts`
- [ ] Run to pass (after the SQL file + journal entry + `backfillLegacyOrangeCovers` are in place): `source ~/.zshenv && pnpm vitest run tests/lib/pages/migration-0063.test.ts tests/lib/pages/backfill-legacy-cover.test.ts tests/db/migrate.test.ts`
- [ ] Commit: `feat(db): migration 0063 backfill legacy orange covers to slate-dusk (#214)`

---

## M-GATE — Group gate (single PR onto `patches/v0.9.9`, HOLD for GO)

Verify the whole group on GitHub-hosted runners (no self-hosted), zero deferral.

Steps:
- [ ] Lint, 0 errors: `source ~/.zshenv && pnpm lint`
- [ ] Typecheck: `source ~/.zshenv && pnpm typecheck`
- [ ] i18n catalog parity (no new keys missing across en/es/ar; the keys added here — `cover.editAria`, the full `iconPicker.*` object — must exist in all three): `source ~/.zshenv && pnpm vitest run tests/lib/i18n` (and confirm the i18n Biome/coverage rule reports none-new-missing).
- [ ] FULL suite: `source ~/.zshenv && pnpm vitest run`
- [ ] Build: `source ~/.zshenv && pnpm build`
- [ ] e2e UI-acceptance gate (editor group → route-reachability + per-feature deployed-image check), Playwright smoke against the deployed image on a GitHub-hosted runner:
  - Route reachability: `/pages/<seeded-page-id>` returns 200 and renders the cover banner + picker trigger.
  - Per-feature deployed-image checks:
    - M1: open the cover picker → "Use default" is a muted text-link at the bottom (not a full-width primary button).
    - M2: gradient swatches render as a 4×2 grid (8 swatches).
    - M3: a `{kind:'color'}` page → reopening the picker shows the current hex prefilled in the Custom hex field.
    - M4: clicking the rendered cover banner opens the picker dialog (`role="dialog"`, name "Page cover").
    - M5: hovering the icon-picker Emoji/Upload/Remove controls surfaces the native `title` tooltips.
    - M6: a page seeded with `{kind:'color',value:'#ea580c'}` renders the `slate-dusk` gradient after the deployed image runs entrypoint migrations through 0063.
- [ ] Open a single PR onto `patches/v0.9.9`; **HOLD for user GO** before merge. (Do not push from a subagent; the controller/human pushes.)

Sub-items: 6 (M1–M6) + 1 gate.

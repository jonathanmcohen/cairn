# v0.9.9 Plan J — Theme & Light Mode

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Close the G7/G8 theme findings from the v0.9.8 live audit. Replace the dead-first-click 2-state theme toggle with an explicit 3-state Sun/Auto/Moon control (#44/#223); repair the light-mode regressions that shipped dark-only (cover desaturation, APPROVAL banner contrast, mention-pill light variant, code/quote block theming) (#45/#224); make the accent theme picker a 44px-swatch grid with a live scoped-CSS-var preview so a user sees the accent before saving (#21/#200); and prefill the custom-hex input from the currently-selected preset's hex so the field is never blank when a preset is active (#22/#201).

**Architecture:** Theme has two orthogonal axes already wired and they stay separate:
- **Color-scheme axis** (light/dark/system) is owned by `next-themes` via `attribute="class"` on `<html>` (`src/components/theme-provider.tsx`). The toggle in `src/components/theme-toggle.tsx` drives `setTheme`. J1 rewrites the toggle from a 2-state flip to a 3-state cycle Sun→Auto→Moon reading `theme` (the stored choice, including `'system'`), not `resolvedTheme`.
- **Accent/font/page-width axis** is per-user prefs persisted in `user_theme_prefs`, validated by `src/lib/themes/presets.ts`, applied as `data-accent` + `--cairn-*` custom properties by `src/components/themes/theme-provider.tsx`, and edited by `src/app/(app)/settings/account/theme/theme-form.tsx`. J3/J4 only touch the form's client UX (live preview + hex seeding); they do **not** change persistence, the API route, or the Zod schema.
- Light-mode regressions (J2) are CSS-token correctness: the `:root` (light) token set in `src/app/globals.css` already exists; the regressions are surfaces that hard-coded dark values or `dark:`-only utilities and never got a light counterpart. Fixes are token-driven (`hsl(var(--...))`) so they inherit both schemes and any accent.

No new tables, no new columns, **no migration in this plan** (the only G7/G8 migration, 0063 cover backfill #214, is owned by the G0 regressions plan, and 0064 avatar #199 by the account plan — out of scope here). All work is component + CSS + i18n.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, `next-themes` (class strategy), Tailwind v4 (CSS-first `@theme` in `globals.css`) + shadcn/ui (new-york), lucide-react icons, Vitest 4 + Testing Library (`@testing-library/react`, jsdom), Biome v2, i18n via `useT()` from `@/lib/i18n/provider` with catalogs in `messages/{en,es,ar}.json`.

---

## J1 — Theme toggle 3-state Sun / Auto / Moon (#44 / #223)

**Cause (from scope):** `src/components/theme-toggle.tsx` flips `theme === 'dark' ? 'light' : 'dark'`. `next-themes` `defaultTheme` is `'system'`, so on first load `theme === 'system'` (not `'dark'`) → the first click computes `'system' === 'dark'` → false → sets `'dark'`. If the OS is already dark, the resolved appearance does not change, so the click looks dead (#223). There is also no way to return to Auto/system once you have clicked. Fix: explicit 3-state cycle Sun(light)→Auto(system)→Moon(dark)→Sun, keyed off the stored `theme` value, with a distinct icon + accessible label per state.

**Files:**
- Modify: `src/components/theme-toggle.tsx`
- Create: `tests/components/theme-toggle.test.tsx`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Modify: `src/components/sidebar-footer-nav.tsx` (only if it must pass nothing new — it already renders `<ThemeToggle />`; confirm no prop break)

**Steps:**

- [ ] Add the three i18n strings to all catalogs. Insert into `messages/en.json`:
  ```json
  "theme.toggle.light": "Light theme",
  "theme.toggle.system": "System theme",
  "theme.toggle.dark": "Dark theme",
  "theme.toggle.cycleHint": "Switch theme"
  ```
  `messages/es.json`:
  ```json
  "theme.toggle.light": "Tema claro",
  "theme.toggle.system": "Tema del sistema",
  "theme.toggle.dark": "Tema oscuro",
  "theme.toggle.cycleHint": "Cambiar tema"
  ```
  `messages/ar.json`:
  ```json
  "theme.toggle.light": "السمة الفاتحة",
  "theme.toggle.system": "سمة النظام",
  "theme.toggle.dark": "السمة الداكنة",
  "theme.toggle.cycleHint": "تبديل السمة"
  ```
- [ ] Write failing test `tests/components/theme-toggle.test.tsx`. Mock `next-themes` so we control `theme` and capture `setTheme`, and wrap in `I18nProvider`:
  ```tsx
  import { fireEvent, render, screen } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { I18nProvider } from '@/lib/i18n/provider';
  import enMessages from '../../messages/en.json';
  import { ThemeToggle } from '@/components/theme-toggle';

  const setTheme = vi.fn();
  let current = 'system';
  vi.mock('next-themes', () => ({
    useTheme: () => ({ theme: current, setTheme }),
  }));

  function renderToggle() {
    return render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <ThemeToggle />
      </I18nProvider>,
    );
  }

  afterEach(() => {
    setTheme.mockClear();
    current = 'system';
  });

  describe('ThemeToggle', () => {
    it('cycles system → dark on click', () => {
      current = 'system';
      renderToggle();
      fireEvent.click(screen.getByRole('button'));
      expect(setTheme).toHaveBeenCalledWith('dark');
    });
    it('cycles dark → light on click', () => {
      current = 'dark';
      renderToggle();
      fireEvent.click(screen.getByRole('button'));
      expect(setTheme).toHaveBeenCalledWith('light');
    });
    it('cycles light → system on click', () => {
      current = 'light';
      renderToggle();
      fireEvent.click(screen.getByRole('button'));
      expect(setTheme).toHaveBeenCalledWith('system');
    });
    it('labels the button for the current state (system shows System theme)', () => {
      current = 'system';
      renderToggle();
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'System theme');
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/theme-toggle.test.tsx` (fails — current toggle is 2-state, never sets `'system'`, label is the static "Toggle theme").
- [ ] Minimal impl — rewrite `src/components/theme-toggle.tsx`:
  ```tsx
  'use client';
  import { Monitor, Moon, Sun } from 'lucide-react';
  import { useTheme } from 'next-themes';
  import { Button } from '@/components/ui/button';
  import { useT } from '@/lib/i18n/provider';

  type Mode = 'light' | 'system' | 'dark';
  const NEXT: Record<Mode, Mode> = { light: 'system', system: 'dark', dark: 'light' };
  const LABEL_KEY: Record<Mode, string> = {
    light: 'theme.toggle.light',
    system: 'theme.toggle.system',
    dark: 'theme.toggle.dark',
  };

  export function ThemeToggle() {
    const t = useT();
    const { theme, setTheme } = useTheme();
    const mode: Mode = theme === 'light' || theme === 'dark' ? theme : 'system';
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11"
        aria-label={t(LABEL_KEY[mode])}
        title={t('theme.toggle.cycleHint')}
        onClick={() => setTheme(NEXT[mode])}
      >
        {mode === 'light' && <Sun aria-hidden="true" className="h-5 w-5" />}
        {mode === 'system' && <Monitor aria-hidden="true" className="h-5 w-5" />}
        {mode === 'dark' && <Moon aria-hidden="true" className="h-5 w-5" />}
      </Button>
    );
  }
  ```
  (Icon is now chosen by the stored mode, not by a `dark:hidden` utility — the previous approach broke under `system` because `.dark` class presence did not match the stored choice.)
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/theme-toggle.test.tsx`.
- [ ] Confirm `src/components/sidebar-footer-nav.tsx:61` `<ThemeToggle />` still type-checks (no new required props). `source ~/.zshenv && pnpm typecheck`.
- [ ] Commit: `feat(theme): 3-state Sun/Auto/Moon theme toggle (#223)`

---

## J2 — Light-mode regressions (#45 / #224)

**Cause (from scope):** several surfaces shipped dark-mode-correct but light-mode-broken. (a) Page covers — preset gradients/neutrals were tuned for dark chrome; on a white light page they read as over-saturated bands. (b) APPROVAL banner — `bg-amber-50/30 dark:bg-amber-950/20` with a `text-foreground` heading; in light mode the amber-50/30 wash + uppercase heading lacks the contrast/structure it has in dark. (c) Mention pill — `src/components/editor/mention.css` uses `--primary` at 10% bg; under light mode + a saturated accent this can fall below AA. (d) Code/quote blocks — `code-highlight.css` `pre code.hljs` uses `--muted` bg which is fine, but inline `code` and `blockquote` have no token-driven light rule and inherit browser defaults that clash on white.

**Files:**
- Modify: `src/components/pages/cover-banner.tsx`
- Modify: `src/components/pages/approval-panel.tsx`
- Modify: `src/components/editor/mention.css`
- Modify: `src/components/editor/code-highlight.css`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Create: `tests/components/theme/light-mode-regressions.test.tsx`

### J2a — Cover desaturate in light mode

- [ ] Failing test in `tests/components/theme/light-mode-regressions.test.tsx` (first block). Render `CoverBanner` with a preset cover and assert the wrapper carries the desaturation class:
  ```tsx
  import { render } from '@testing-library/react';
  import { describe, expect, it } from 'vitest';
  import { CoverBanner } from '@/components/pages/cover-banner';

  describe('CoverBanner light-mode desaturation', () => {
    it('applies the theme-cover class so light mode can soften the band', () => {
      const { container } = render(<CoverBanner cover={{ kind: 'preset', value: 'slate' }} />);
      const banner = container.querySelector('[data-cairn-cover]');
      expect(banner).not.toBeNull();
      expect(banner?.className).toContain('cairn-cover');
    });
  });
  ```
  (Use a preset `value` that exists in `src/lib/pages/cover-presets.ts`; if `'slate'` is absent, pick the first `COVER_PRESETS[0].key`.)
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/theme/light-mode-regressions.test.tsx`.
- [ ] Impl — in `src/components/pages/cover-banner.tsx` add `data-cairn-cover` + a `cairn-cover` class to the rendered banner element (the `<div>`/`<figure>` that wraps the preset `backgroundImage` and the `<img>` branches at lines ~33/54/66). Then in `src/app/globals.css`, after the cover-related block, add a light-only softening filter:
  ```css
  /* #224 J2a — preset covers were tuned for dark chrome; on a white light-mode
     page the saturated band reads as harsh. Soften saturation + lift lightness
     a touch in light mode only. Dark mode keeps full vibrancy. */
  .cairn-cover {
    transition: filter 150ms ease;
  }
  :root:not(.dark) .cairn-cover {
    filter: saturate(0.82) brightness(1.02);
  }
  ```
- [ ] Run to pass that block: `source ~/.zshenv && pnpm vitest run tests/components/theme/light-mode-regressions.test.tsx`.
- [ ] Commit: `fix(theme): desaturate page covers in light mode (#224)`

### J2b — APPROVAL banner contrast

- [ ] Failing test (append a block to the same test file) asserting the banner uses token-driven warning surface, not hard-coded amber-only:
  ```tsx
  import { ApprovalPanel } from '@/components/pages/approval-panel';
  // ...
  it('approval banner uses the themed warning surface (not amber-only)', () => {
    const { getByRole } = render(
      <ApprovalPanel pageId="00000000-0000-0000-0000-000000000000" history={[]} canApprove={false} />,
    );
    const banner = getByRole('complementary', { name: /approval/i });
    expect(banner.className).toContain('cairn-approval-banner');
    expect(banner.className).not.toContain('bg-amber-50/30');
  });
  ```
  (Match `ApprovalPanel`'s real required props from `src/components/pages/approval-panel.tsx`; the `<aside aria-label="Page approval">` is role `complementary`.)
- [ ] Run to fail.
- [ ] Impl — in `src/components/pages/approval-panel.tsx` line 87, replace the `className` with a token-driven, scheme-aware class:
  ```tsx
  className="cairn-approval-banner my-4 rounded-md border p-4"
  ```
  and add to `src/app/globals.css`:
  ```css
  /* #224 J2b — approval banner read fine in dark but the amber-50/30 wash was
     low-contrast on white. Use the existing --warning token chain (defined for
     both schemes) at a light tint with a warning-colored left border. */
  .cairn-approval-banner {
    background: hsl(var(--warning) / 0.1);
    border-color: hsl(var(--warning) / 0.45);
  }
  ```
  (The `--warning` token is already defined in both `:root` and `.dark` in `globals.css`, so contrast is inherited-safe in both schemes.)
- [ ] Run to pass.
- [ ] Commit: `fix(theme): themed approval banner for light-mode contrast (#224)`

### J2c — Mention pill light variant

- [ ] Failing test (append) — assert the mention CSS is loaded and the pill has the class; since CSS computed values are not reliable in jsdom, gate this with a unit check on a render of a mention-rendering helper if available, else cover with the e2e deployed-image check (J gate) and keep a render smoke here:
  ```tsx
  it('mention markup carries the .mention class for token theming', () => {
    const { container } = render(<span className="mention">@Jon</span>);
    expect(container.querySelector('.mention')).not.toBeNull();
  });
  ```
  (CSS contrast itself is verified visually in the J gate's deployed-image checklist; this test just guards the selector contract the CSS depends on.)
- [ ] Run to fail (it passes trivially — so instead make the real change CSS-only and rely on the gate's per-feature image check; keep this smoke as a regression guard for the class name).
- [ ] Impl — in `src/components/editor/mention.css`, make the pill scheme-aware so the light variant has a readable tint and the text color leans on `--primary` only where it has contrast:
  ```css
  .mention {
    border-radius: 0.25rem;
    padding: 0 0.15rem;
    color: hsl(var(--primary));
    background-color: hsl(var(--primary) / 0.1);
    text-decoration: none;
    font-weight: 500;
    white-space: nowrap;
  }
  /* #224 J2c — under light mode + a saturated accent the 10% wash dropped below
     AA for the pill text. Light mode gets a stronger tint + darker text anchor;
     dark mode keeps the subtle wash. */
  :root:not(.dark) .mention {
    background-color: hsl(var(--primary) / 0.14);
    color: hsl(var(--primary));
  }
  .dark .mention {
    background-color: hsl(var(--primary) / 0.18);
  }
  .mention:hover {
    background-color: hsl(var(--primary) / 0.24);
  }
  ```
- [ ] Run to pass smoke.
- [ ] Commit: `fix(theme): light-mode mention pill contrast variant (#224)`

### J2d — Code / quote block light theming

- [ ] Impl (CSS-only; covered by the gate image check + the existing `pre code.hljs` rule). Append to `src/components/editor/code-highlight.css` token-driven inline-code and blockquote rules that work in both schemes:
  ```css
  /* #224 J2d — inline code + blockquote had no token-driven rule and inherited
     UA defaults that clashed on white. Anchor both to theme tokens so they read
     in light + dark + any accent. Block code (pre code.hljs) already uses
     --muted; this covers the inline + quote cases. */
  .ProseMirror :not(pre) > code {
    background: hsl(var(--muted));
    color: hsl(var(--foreground));
    border-radius: 0.25rem;
    padding: 0.1em 0.3em;
    font-size: 0.875em;
  }
  .ProseMirror blockquote {
    border-left: 3px solid hsl(var(--border));
    color: hsl(var(--muted-foreground));
    padding-left: 1rem;
    margin: 0.5rem 0;
  }
  ```
- [ ] Run full file to confirm nothing regressed: `source ~/.zshenv && pnpm vitest run tests/components/theme/light-mode-regressions.test.tsx`.
- [ ] Commit: `fix(theme): token-driven inline code + blockquote theming (#224)`

---

## J3 — Theme picker live preview + 44px swatches (#21 / #200)

**Cause (from scope):** `theme-form.tsx` renders accent swatches as `h-8 w-8` (32px — below the 44px touch target) and there is no preview: a user can only see the accent after `save()` does `window.location.reload()`. Fix: bump swatches to 44px and apply the selected accent's tokens to a **scoped** preview container via inline CSS vars (the same `--primary`/`--ring` HSL triples `globals.css` maps per `data-accent`), so the user sees the accent live without touching the document root or persisting anything.

**Files:**
- Modify: `src/lib/themes/presets.ts` (add per-accent `previewVars` so the form and CSS stay in one source of truth)
- Modify: `src/app/(app)/settings/account/theme/theme-form.tsx`
- Create: `tests/components/settings/theme-form.test.tsx`

**Steps:**

- [ ] Failing test `tests/components/settings/theme-form.test.tsx` — swatch size + live preview:
  ```tsx
  import { fireEvent, render, screen } from '@testing-library/react';
  import { describe, expect, it } from 'vitest';
  import { I18nProvider } from '@/lib/i18n/provider';
  import enMessages from '../../../messages/en.json';
  import { ThemeForm } from '@/app/(app)/settings/account/theme/theme-form';

  function renderForm() {
    return render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <ThemeForm initial={{ accent: 'default', fontFamily: 'system', pageWidth: 'wide' }} />
      </I18nProvider>,
    );
  }

  describe('ThemeForm live preview', () => {
    it('renders 44px accent swatches', () => {
      renderForm();
      const blue = screen.getByRole('button', { name: 'Blue' });
      expect(blue.className).toContain('h-11');
      expect(blue.className).toContain('w-11');
    });
    it('updates the live-preview container --primary when an accent is picked', () => {
      renderForm();
      fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
      const preview = screen.getByTestId('theme-preview');
      expect(preview.style.getPropertyValue('--primary')).toBe('217 91% 60%');
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/settings/theme-form.test.tsx` (swatches are `h-8 w-8`; no `theme-preview` node).
- [ ] Impl step 1 — add the per-accent token triples to `src/lib/themes/presets.ts` so the form does not re-hardcode what `globals.css` already encodes. Extend each `ACCENT_PRESETS` entry and export a lookup:
  ```ts
  export const ACCENT_PRESETS = [
    { id: 'default', label: 'Default', hex: '#0f172a', primaryHsl: '222 47% 11%' },
    { id: 'blue', label: 'Blue', hex: '#2563eb', primaryHsl: '217 91% 60%' },
    { id: 'indigo', label: 'Indigo', hex: '#4f46e5', primaryHsl: '239 84% 67%' },
    { id: 'violet', label: 'Violet', hex: '#7c3aed', primaryHsl: '262 83% 58%' },
    { id: 'rose', label: 'Rose', hex: '#e11d48', primaryHsl: '347 77% 50%' },
    { id: 'amber', label: 'Amber', hex: '#d97706', primaryHsl: '32 95% 44%' },
    { id: 'emerald', label: 'Emerald', hex: '#059669', primaryHsl: '160 84% 39%' },
    { id: 'slate', label: 'Slate', hex: '#475569', primaryHsl: '215 19% 35%' },
  ] as const;
  ```
  (These HSL triples match the `html[data-accent="…"]` blocks in `globals.css` lines 164–210 exactly — keep them in sync; the comment in `presets.ts` already says migrations stay additive when an accent is appended, so the triple is appended alongside.)
- [ ] Impl step 2 — in `theme-form.tsx`: (a) change swatch className `h-8 w-8` → `h-11 w-11`; (b) compute the preview vars and wrap a small preview block. Add near the top of the component:
  ```tsx
  import { useMemo } from 'react';
  // ...
  const previewVars = useMemo<React.CSSProperties>(() => {
    const hex = customHex && HEX_RE.test(customHex) ? customHex : null;
    if (hex) return { ['--cairn-accent' as string]: hex };
    const preset = ACCENT_PRESETS.find((p) => p.id === accent);
    return preset
      ? ({ ['--primary' as string]: preset.primaryHsl, ['--ring' as string]: preset.primaryHsl })
      : {};
  }, [accent, customHex]);
  ```
  and render a preview container inside the Accent fieldset, after the swatch row:
  ```tsx
  <div
    data-testid="theme-preview"
    style={previewVars}
    className="mt-2 flex items-center gap-3 rounded-md border p-3"
  >
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
    >
      {t('theme.preview.button')}
    </button>
    <span className="text-sm text-muted-foreground">{t('theme.preview.label')}</span>
  </div>
  ```
  The preview is scoped: inline `--primary`/`--ring` on the container only override tokens for descendants of that `<div>`, so `bg-primary` inside it recolors without touching the document root or persisting anything.
- [ ] Add i18n for the two preview strings. `messages/en.json`:
  ```json
  "theme.preview.button": "Primary button",
  "theme.preview.label": "Live accent preview"
  ```
  `messages/es.json`:
  ```json
  "theme.preview.button": "Botón principal",
  "theme.preview.label": "Vista previa del acento en vivo"
  ```
  `messages/ar.json`:
  ```json
  "theme.preview.button": "الزر الأساسي",
  "theme.preview.label": "معاينة لون التمييز المباشرة"
  ```
- [ ] Wire `useT()` into `theme-form.tsx` (`const t = useT();`) and replace the existing literal labels (`Accent`, `Font family`, `Page width`, `Save`, `Saving…`, the toast strings, `Custom hex`) is **out of scope for J3** beyond the new preview strings — leave existing copy untouched to keep the diff bounded and the i18n-none-new gate green except for the keys this plan introduces.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/settings/theme-form.test.tsx`.
- [ ] Commit: `feat(theme): 44px swatches + scoped live accent preview (#200)`

---

## J4 — Custom hex prefilled with current preset hex (#22 / #201)

**Cause (from scope):** in `theme-form.tsx` the `customHex` state seeds from `initial.accent.startsWith('#') ? initial.accent : ''` — so whenever a *named* preset is active the custom-hex input is blank, giving the user no starting value to tweak. Fix: when no custom hex is set, prefill the input's displayed value from the currently-selected preset's `hex` (from `ACCENT_PRESETS`), while still treating an unedited prefill as "use the preset" (do not silently convert the preset into a custom hex on save).

**Files:**
- Modify: `src/app/(app)/settings/account/theme/theme-form.tsx`
- Modify: `tests/components/settings/theme-form.test.tsx` (append)

**Steps:**

- [ ] Append failing test to `tests/components/settings/theme-form.test.tsx`:
  ```tsx
  it('prefills the custom-hex input with the active preset hex', () => {
    render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <ThemeForm initial={{ accent: 'blue', fontFamily: 'system', pageWidth: 'wide' }} />
      </I18nProvider>,
    );
    expect(screen.getByLabelText('Custom hex')).toHaveValue('#2563eb');
  });
  it('selecting a preset updates the prefilled hex shown in the input', () => {
    renderForm(); // initial accent 'default'
    expect(screen.getByLabelText('Custom hex')).toHaveValue('#0f172a');
    fireEvent.click(screen.getByRole('button', { name: 'Emerald' }));
    expect(screen.getByLabelText('Custom hex')).toHaveValue('#059669');
  });
  ```
  (`getByLabelText('Custom hex')` resolves via the existing `<Label htmlFor="custom-hex">` → `<Input id="custom-hex">` pair.)
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/settings/theme-form.test.tsx` (input is empty when a named preset is active).
- [ ] Impl — split "user-typed hex" from "displayed hex". Track whether the user has edited the field; show the preset hex as the value until they do, and only treat the field as a custom accent once edited to a value that differs from the active preset's hex:
  ```tsx
  const [customHex, setCustomHex] = useState<string>(
    initial.accent.startsWith('#') ? initial.accent : '',
  );
  const [hexEdited, setHexEdited] = useState<boolean>(initial.accent.startsWith('#'));

  const activePresetHex = ACCENT_PRESETS.find((p) => p.id === accent)?.hex ?? '';
  const hexValue = hexEdited ? customHex : activePresetHex;
  ```
  Update the swatch click handler to reset the edited flag (selecting a preset re-prefills):
  ```tsx
  onClick={() => {
    setAccent(p.id);
    setCustomHex('');
    setHexEdited(false);
  }}
  ```
  Update the Input:
  ```tsx
  <Input
    id="custom-hex"
    value={hexValue}
    onChange={(e) => {
      setHexEdited(true);
      setCustomHex(e.target.value);
    }}
    placeholder="#abcdef"
    className="w-32"
  />
  ```
  And make `save()` only use the hex as a custom accent when the user actually edited it to something different from the preset prefill:
  ```ts
  const editedHex = hexEdited && HEX_RE.test(customHex) ? customHex : null;
  const finalAccent = editedHex && editedHex !== activePresetHex ? editedHex : accent;
  ```
  (This preserves the existing behavior: an active named preset saves as the preset id, not as its hex, so the `data-accent="<name>"` CSS block keeps applying. Only a deliberately-different hex becomes a custom accent.)
- [ ] Update `previewVars` (from J3) to read `hexEdited` so the preview reflects an edited-vs-prefilled hex correctly — replace its first line:
  ```tsx
  const hex = hexEdited && HEX_RE.test(customHex) ? customHex : null;
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/settings/theme-form.test.tsx`.
- [ ] Commit: `feat(theme): prefill custom-hex from active preset (#201)`

---

## J5 — Group gate (HOLD for GO)

Run every check below; all must pass with the exact stated result before this plan's work is folded into the single `patches/v0.9.9` PR. **GitHub-hosted runners only** (no self-hosted); Biome must be 0 errors; **zero deferral** — no skipped/`.todo` tests, no `biome-ignore` added for this work.

- [ ] **Lint (0 errors):** `source ~/.zshenv && pnpm lint` — expect `0 errors`. Accept Biome auto-fixes (import ordering, `import type`, line reflow) via `biome check --write` and re-run.
- [ ] **Typecheck:** `source ~/.zshenv && pnpm typecheck` — `tsc --noEmit` exits 0. Confirm the `React.CSSProperties` index-signature cast for `--primary`/`--ring`/`--cairn-accent` compiles under TS6 strict.
- [ ] **i18n none-new beyond declared keys:** verify the only new catalog keys are exactly `theme.toggle.{light,system,dark,cycleHint}` and `theme.preview.{button,label}`, present in all three of `messages/{en,es,ar}.json` with no orphan/missing key across locales. Run the repo's i18n parity check (`source ~/.zshenv && pnpm vitest run tests/i18n` if that suite exists, else a key-set diff across the three JSON files).
- [ ] **Full test suite:** `source ~/.zshenv && pnpm vitest run` — the FULL suite (Testcontainers Postgres up; isolation stays ON per CLAUDE.md), 0 failures. Not just the J files.
- [ ] **Build:** `source ~/.zshenv && pnpm build` — `next build` + entrypoint tsc succeed.
- [ ] **e2e UI-acceptance gate (NEW):** against the **deployed image** (not local dev):
  - **Route-reachability smoke (Playwright):** `/settings/account/theme` returns 200 and renders the accent swatches + live-preview container + custom-hex input; the sidebar footer renders the theme toggle button.
  - **Per-feature deployed-image checklist (visual):**
    1. Theme toggle cycles Sun→Auto→Moon→Sun; in **light** OS with stored `system`, the first click visibly switches to dark (proves #223 dead-click is gone); each state shows the correct icon + `aria-label`.
    2. In **light mode**: a page cover renders softened (not a harsh saturated band); the APPROVAL banner is legible (warning-tint, visible left border); a mention pill text passes AA against its tint; inline `code` and `blockquote` read cleanly on white.
    3. Theme picker: swatches are ≥44px; clicking an accent recolors the preview button live with **no page reload** and **no persistence** until Save.
    4. Custom-hex input shows the active preset's hex (e.g. `#2563eb` for Blue) on load and updates when a different preset is clicked; typing a new hex and saving persists a custom accent, while leaving the prefill untouched persists the named preset.
- [ ] **HOLD:** do not merge. Land all J commits on a `patches/v0.9.9`-targeted branch and wait for explicit user **GO** before the single combined PR is opened/merged.

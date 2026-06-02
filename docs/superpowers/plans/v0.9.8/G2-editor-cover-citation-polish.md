# Cairn v0.9.8 — G2: Editor / cover / citation polish (audit items C, D, K, L)

**For agentic workers:** REQUIRED SUB-SKILL — read and follow `superpowers:test-driven-development` for every task in this plan. Write the failing test first, run it to confirm it fails for the expected reason, write the minimal implementation, run it to green, then commit. Do not skip the run-to-fail step.

**Goal:** Close audit items C, D, K, L from the v0.9.7 production browser audit — all source-side polish, no migration. (C) Lock in the slate-dusk default + expand the curated cover palette + make the custom-hex contrast warning evaluate against the *actual* resolved title-overlay foreground color instead of a hardcoded `#fafafa`. (D) Show a live citation count on the bibliography toggle (0 muted, ≥1 prominent), keeping References self-hide at 0. (K) Add unlock-authority clarity to the lock banner ("You can unlock" vs "an admin can unlock"), fully i18n'd. (L) Add integration tests for the DOI lookup happy + error (502) paths and fix any bug surfaced.

**Architecture:** All changes are in existing modules — no new tables, no migration (per spec Section 2: "No migration: … C/D/K UI … L test"). The cover palette is a pure registry (`src/lib/pages/cover-presets.ts`) consumed by a client picker. Contrast math already lives in a pure, server-and-client-safe module (`src/lib/color/contrast.ts`, `meetsAA(fg, bg)`). Citations are aggregated by a pure ProseMirror walker (`src/lib/citations/aggregate.ts#aggregateCitations`) already mounted in the editor; the toggle just needs the derived count. The lock banner is a React **server component** (`src/components/pages/lock-banner.tsx`) so it cannot use the `useT()` client hook — it resolves locale server-side via `cookies()`/`headers()` + `resolveLocale` + `getMessages` + `createT`, the established server-component i18n pattern (see `src/app/(app)/favorites/page.tsx:32-38`). The DOI route (`src/app/api/citations/lookup/route.ts`) is exercised by an existing `vi.mock`-based test (`tests/lib/citations/route.test.ts`); we extend it with the upstream-failure → 502 path.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, Biome v2, Vitest 4 (node env for pure-lib tests), Tailwind v4 + shadcn/ui, i18n en/es/ar via `useT()` (client) / `createT` (server). Shell commands MUST be prefixed with `source ~/.zshenv && `.

---

## Files

| Task | Action | Path | Refs |
|------|--------|------|------|
| 1 | Modify | `tests/lib/pages/cover-presets.test.ts` | add no-orange + count assertions |
| 1 | Modify | `src/lib/pages/cover-presets.ts` | expand `COVER_PRESETS` (cover-presets.ts:29-109) |
| 2 | Create | `tests/lib/color/title-contrast.test.ts` | new pure test |
| 2 | Create | `src/lib/color/title-contrast.ts` | resolves theme foreground token |
| 2 | Modify | `src/components/pages/cover-picker.tsx` | contrast warning 199-228, `TITLE_REFERENCE` 16-19 |
| 3 | Create | `tests/lib/citations/citation-count.test.ts` | new node test |
| 3 | Modify | `src/components/editor/bibliography-toggle.tsx` | toggle button 54-69, props 16-24 |
| 3 | Modify | `src/components/editor/editor.tsx` | toggle mount 579-583, biblio mount 619 |
| 3 | Modify | `messages/{en,es,ar}.json` | `editor.bibliography.count` keys |
| 4 | Modify | `src/components/pages/lock-banner.tsx` | banner 36-77 |
| 4 | Modify | `messages/{en,es,ar}.json` | `lock.banner.*` keys |
| 5 | Modify | `tests/lib/citations/route.test.ts` | add 502 + happy-meta assertions |

---

## Task 1 — (C) Lock the slate-dusk default + expand & guard the palette

The default is already `slate-dusk` (`cover-presets.ts:112`) and orange was removed, but the audit demands an explicit regression guard plus a richer curated set. Expand to **9 gradients + 6 neutrals (15 total)**, all AA-safe against the title color, and add an assertion that **no** preset `solid` is an orange hex.

### Step 1.1 — Write the failing test

Edit `tests/lib/pages/cover-presets.test.ts`. Replace the count assertion and the default assertion, and add a no-orange guard.

Replace the `it('exposes 7 gradients and 4 neutrals (11 total)', …)` block (lines 15-21) with:

```ts
  it('exposes 9 gradients and 6 neutrals (15 total)', () => {
    const gradients = COVER_PRESETS.filter((p) => p.type === 'gradient');
    const neutrals = COVER_PRESETS.filter((p) => p.type === 'neutral');
    expect(gradients).toHaveLength(9);
    expect(neutrals).toHaveLength(6);
    expect(COVER_PRESETS).toHaveLength(15);
  });
```

Add this new `it` block immediately after the `'the default preset key resolves to a real gradient preset'` block (after line 62, before the closing `});` of the `describe('COVER_PRESETS registry', …)`):

```ts
  it('the default preset key is exactly slate-dusk (finding C regression guard)', () => {
    expect(DEFAULT_COVER_PRESET_KEY).toBe('slate-dusk');
  });

  it('NO preset solid is an orange hue (finding C — orange removed for good)', () => {
    // Orange = hue ~20-50deg with meaningful saturation. Reject any such tone.
    for (const p of COVER_PRESETS) {
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(p.solid);
      expect(m).not.toBeNull();
      if (!m) continue;
      const r = Number.parseInt(m[1], 16) / 255;
      const g = Number.parseInt(m[2], 16) / 255;
      const b = Number.parseInt(m[3], 16) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      const sat = max === 0 ? 0 : delta / max;
      let hue = 0;
      if (delta !== 0) {
        if (max === r) hue = 60 * (((g - b) / delta) % 6);
        else if (max === g) hue = 60 * ((b - r) / delta + 2);
        else hue = 60 * ((r - g) / delta + 4);
      }
      if (hue < 0) hue += 360;
      const isOrange = hue >= 20 && hue <= 50 && sat > 0.4;
      expect(isOrange, `${p.key} (${p.solid}) is orange`).toBe(false);
    }
  });
```

### Step 1.2 — Run to fail

```sh
source ~/.zshenv && pnpm vitest run tests/lib/pages/cover-presets.test.ts
```

Expected: FAIL — `exposes 9 gradients and 6 neutrals (15 total)` fails (`expected 7 to be 9`). The orange-guard passes already (none orange) but the count assertion is red.

### Step 1.3 — Minimal implementation

Edit `src/lib/pages/cover-presets.ts`. Add two gradients (after the `ocean-fade` entry, before the `// --- Muted neutrals` comment on line 80) and two neutrals (after the `slate` entry, before the closing `] as const;` on line 109).

Insert after the `ocean-fade` block (after line 79):

```ts
  {
    key: 'rose-quartz',
    type: 'gradient',
    css: 'linear-gradient(135deg, #831843 0%, #500724 100%)',
    solid: '#831843',
    nameKey: 'cover.preset.roseQuartz',
  },
  {
    key: 'cobalt-fade',
    type: 'gradient',
    css: 'linear-gradient(135deg, #1e3a8a 0%, #172554 100%)',
    solid: '#1e3a8a',
    nameKey: 'cover.preset.cobaltFade',
  },
```

Insert after the `slate` block (after line 108):

```ts
  {
    key: 'charcoal',
    type: 'neutral',
    css: '#18181b',
    solid: '#18181b',
    nameKey: 'cover.preset.charcoal',
  },
  {
    key: 'walnut',
    type: 'neutral',
    css: '#3f3f46',
    solid: '#3f3f46',
    nameKey: 'cover.preset.walnut',
  },
```

Add the four new i18n keys. In `messages/en.json`, after `"cover.preset.slate": "Slate",` (line 311):

```json
  "cover.preset.roseQuartz": "Rose quartz",
  "cover.preset.cobaltFade": "Cobalt fade",
  "cover.preset.charcoal": "Charcoal",
  "cover.preset.walnut": "Walnut",
```

In `messages/es.json`, after the matching `"cover.preset.slate"` entry:

```json
  "cover.preset.roseQuartz": "Cuarzo rosa",
  "cover.preset.cobaltFade": "Cobalto difuminado",
  "cover.preset.charcoal": "Carbón",
  "cover.preset.walnut": "Nogal",
```

In `messages/ar.json`, after the matching `"cover.preset.slate"` entry:

```json
  "cover.preset.roseQuartz": "كوارتز وردي",
  "cover.preset.cobaltFade": "كوبالت متدرج",
  "cover.preset.charcoal": "فحمي",
  "cover.preset.walnut": "جوزي",
```

### Step 1.4 — Run to pass

```sh
source ~/.zshenv && pnpm vitest run tests/lib/pages/cover-presets.test.ts
```

Expected: PASS — all assertions green, including the new 15-total count, the no-orange guard, and the still-passing `every preset PASSES WCAG AA against the page-title color`. (All four new solids — `#831843`, `#1e3a8a`, `#18181b`, `#3f3f46` — are dark and pass AA vs `#fafafa`.)

Confirm no orphaned i18n keys:

```sh
source ~/.zshenv && pnpm i18n:check
```

Expected: exit 0, no new missing/extra keys.

### Step 1.5 — Commit

```sh
git add src/lib/pages/cover-presets.ts tests/lib/pages/cover-presets.test.ts messages/en.json messages/es.json messages/ar.json && git commit -m "feat(cover): expand curated palette to 15 presets, guard against orange default (C)"
```

---

## Task 2 — (C) Contrast warning vs the resolved title-overlay foreground color

The picker currently hardcodes `TITLE_REFERENCE = '#fafafa'` (`cover-picker.tsx:16-19`). The page title actually renders on the theme `--foreground` token, which differs by light/dark theme. Add a tiny pure helper that resolves the *effective* foreground hex from the current document theme, default-falling to the dark token, and feed that into the existing `meetsAA(customHex, titleColor)` check (still warning when ratio < 4.5:1).

### Step 2.1 — Write the failing test

Create `tests/lib/color/title-contrast.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveTitleForeground } from '@/lib/color/title-contrast';

describe('resolveTitleForeground', () => {
  it('falls back to the dark-theme foreground when no computed value is given', () => {
    // No DOM / no override → the dark UI default (near-white).
    expect(resolveTitleForeground(undefined)).toBe('#fafafa');
  });

  it('passes through a valid #rrggbb override', () => {
    expect(resolveTitleForeground('#111827')).toBe('#111827');
  });

  it('passes through a valid #rgb override', () => {
    expect(resolveTitleForeground('#000')).toBe('#000');
  });

  it('parses an "R G B" rgb-channel string (getComputedStyle form) to hex', () => {
    expect(resolveTitleForeground('250 250 250')).toBe('#fafafa');
    expect(resolveTitleForeground('17 24 39')).toBe('#111827');
  });

  it('parses an "rgb(r, g, b)" string to hex', () => {
    expect(resolveTitleForeground('rgb(17, 24, 39)')).toBe('#111827');
  });

  it('falls back to the dark default for an unparseable value', () => {
    expect(resolveTitleForeground('not-a-color')).toBe('#fafafa');
    expect(resolveTitleForeground('')).toBe('#fafafa');
  });
});
```

### Step 2.2 — Run to fail

```sh
source ~/.zshenv && pnpm vitest run tests/lib/color/title-contrast.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/color/title-contrast'` (the file does not exist yet).

### Step 2.3 — Minimal implementation

Create `src/lib/color/title-contrast.ts`:

```ts
/**
 * Resolve the *effective* page-title foreground color for the cover contrast
 * heuristic (finding C). The page title overlays the cover on the theme
 * `--foreground` token, which differs between light and dark themes — so the
 * custom-hex warning must compare against the real resolved color, not a
 * hardcoded `#fafafa`.
 *
 * Accepts whatever `getComputedStyle(...).getPropertyValue('--foreground')`
 * (or `color`) yields across browsers — a `#hex`, an `"R G B"` channel triple
 * (Tailwind v4 CSS-var form), or an `rgb(r, g, b)` string — and normalizes to
 * a `#rrggbb` hex. Pure: no DOM access, safe for node-env unit tests. Callers
 * read the computed value in the client component and pass it in.
 */

const DARK_FOREGROUND = '#fafafa';
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function clampChannel(n: number): number {
  if (Number.isNaN(n)) return Number.NaN;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(r: number, g: number, b: number): string | null {
  const rr = clampChannel(r);
  const gg = clampChannel(g);
  const bb = clampChannel(b);
  if (Number.isNaN(rr) || Number.isNaN(gg) || Number.isNaN(bb)) return null;
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(rr)}${h(gg)}${h(bb)}`;
}

export function resolveTitleForeground(computed: string | undefined | null): string {
  if (!computed) return DARK_FOREGROUND;
  const value = computed.trim();
  if (value.length === 0) return DARK_FOREGROUND;

  if (HEX_RE.test(value)) return value;

  // "rgb(17, 24, 39)" or "rgba(17, 24, 39, 1)"
  const rgbMatch = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(value);
  if (rgbMatch) {
    const hex = toHex(Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3]));
    if (hex) return hex;
  }

  // Tailwind v4 CSS-var channel form: "250 250 250"
  const channelMatch = /^([\d.]+)\s+([\d.]+)\s+([\d.]+)$/.exec(value);
  if (channelMatch) {
    const hex = toHex(Number(channelMatch[1]), Number(channelMatch[2]), Number(channelMatch[3]));
    if (hex) return hex;
  }

  return DARK_FOREGROUND;
}
```

### Step 2.4 — Run to pass

```sh
source ~/.zshenv && pnpm vitest run tests/lib/color/title-contrast.test.ts
```

Expected: PASS — all six cases green.

### Step 2.5 — Wire the picker to the resolved color

Edit `src/components/pages/cover-picker.tsx`.

Replace the comment + constant block (lines 16-19):

```ts
// The page title overlays/sits-below the cover on the theme --foreground token.
// In the dark UI that resolves to hsl(0 0% 98%) ≈ #fafafa — the contrast
// reference for the user-pickable custom-hex warning (finding Y).
const TITLE_REFERENCE = '#fafafa';
```

with:

```ts
// The page title overlays/sits-below the cover on the theme `--foreground`
// token. Finding C: resolve the REAL computed token (light vs dark differ)
// rather than hardcoding `#fafafa`, then warn when the custom-hex cover fails
// AA against that actual color.
```

Add the `useEffect` import (line 5 currently `import { useState } from 'react';`) — change to:

```ts
import { useEffect, useState } from 'react';
```

Add the `resolveTitleForeground` import (after line 10's `import { meetsAA } from '@/lib/color/contrast';`):

```ts
import { resolveTitleForeground } from '@/lib/color/title-contrast';
```

Inside `CoverPicker`, after the existing `const [saving, setSaving] = useState(false);` (line 46), add the resolved-foreground state + effect:

```ts
  const [titleColor, setTitleColor] = useState('#fafafa');

  // Read the live `--foreground` token once the modal mounts (client-only).
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const computed = getComputedStyle(document.documentElement).getPropertyValue('--foreground');
    setTitleColor(resolveTitleForeground(computed));
  }, [open]);
```

Replace the contrast-warning JSX (lines 223-228):

```tsx
                    {/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(customHex) &&
                      !meetsAA(customHex, TITLE_REFERENCE) && (
                        <p role="alert" className="text-xs text-destructive">
                          {t('cover.contrastWarning')}
                        </p>
                      )}
```

with:

```tsx
                    {/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(customHex) &&
                      !meetsAA(titleColor, customHex) && (
                        <p role="alert" className="text-xs text-destructive">
                          {t('cover.contrastWarning')}
                        </p>
                      )}
```

(`meetsAA` is symmetric, so swapping the argument order is harmless and reads as "title foreground vs cover background".)

### Step 2.6 — Verify typecheck + lint

```sh
source ~/.zshenv && pnpm typecheck && pnpm lint
```

Expected: typecheck exit 0; lint reports 0 errors (Biome may reorder the new imports — accept).

### Step 2.7 — Commit

```sh
git add src/lib/color/title-contrast.ts tests/lib/color/title-contrast.test.ts src/components/pages/cover-picker.tsx && git commit -m "feat(cover): warn on custom-hex contrast vs resolved title foreground, not hardcoded #fafafa (C)"
```

---

## Task 3 — (D) Live citation count on the bibliography toggle

Derive the count via `aggregateCitations(doc, style)` (`src/lib/citations/aggregate.ts:14`) — already used by the mounted `<Bibliography>` (`editor.tsx:619`) — and render it on the toggle button: a muted badge at 0, a prominent badge at ≥1. The toggle is passed the count from the editor (which already holds `editor.getJSON()` + `citationStyle`). References keeps its self-hide at 0 (`bibliography.tsx:24` unchanged).

### Step 3.1 — Write the failing test

Create `tests/lib/citations/citation-count.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { aggregateCitations } from '@/lib/citations/aggregate';

const cite = (id: string) => ({
  type: 'citation',
  attrs: { id, formatted_apa: `APA ${id}`, formatted_mla: '', formatted_chicago: '' },
});

describe('citation count derivation (finding D)', () => {
  it('is 0 for a doc with no citation nodes', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(aggregateCitations(doc, 'apa')).toHaveLength(0);
  });

  it('counts each unique citation id once (dedup)', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [cite('a'), cite('b')] },
        { type: 'paragraph', content: [cite('a')] }, // duplicate id
      ],
    };
    expect(aggregateCitations(doc, 'apa')).toHaveLength(2);
  });

  it('walks nested block content', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [cite('x'), cite('y'), cite('z')] }],
        },
      ],
    };
    expect(aggregateCitations(doc, 'apa')).toHaveLength(3);
  });
});
```

### Step 3.2 — Run to fail

```sh
source ~/.zshenv && pnpm vitest run tests/lib/citations/citation-count.test.ts
```

Expected: PASS already? No — run it to establish the baseline. `aggregateCitations` exists, so these assertions go GREEN immediately. This test pins the count contract the toggle relies on; if it is already green, proceed (TDD allows a characterization test that locks behavior before the UI change). If any assertion is red, fix `aggregate.ts` minimally before proceeding.

### Step 3.3 — Add the count prop + badge to the toggle

Edit `src/components/editor/bibliography-toggle.tsx`.

Replace the props destructure block (lines 16-24):

```ts
export function BibliographyToggle({
  pageId,
  initialDisabled,
  onChange,
}: {
  pageId: string;
  initialDisabled: boolean;
  onChange?: (disabled: boolean) => void;
}) {
```

with:

```ts
export function BibliographyToggle({
  pageId,
  initialDisabled,
  citationCount,
  onChange,
}: {
  pageId: string;
  initialDisabled: boolean;
  /** Live count of unique citations in the doc (finding D). */
  citationCount: number;
  onChange?: (disabled: boolean) => void;
}) {
```

Replace the `return (...)` button (lines 54-69):

```tsx
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={saving}
      aria-pressed={shown}
      title={t('editor.bibliography.toggleHint')}
      className={
        shown
          ? 'rounded bg-primary px-2 py-1 text-primary-foreground text-xs disabled:opacity-60'
          : 'rounded px-2 py-1 text-muted-foreground text-xs hover:bg-accent disabled:opacity-60'
      }
    >
      {t('editor.bibliography.toggle')}
    </button>
  );
```

with:

```tsx
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={saving}
      aria-pressed={shown}
      title={t('editor.bibliography.toggleHint')}
      className={
        shown
          ? 'inline-flex items-center gap-1.5 rounded bg-primary px-2 py-1 text-primary-foreground text-xs disabled:opacity-60'
          : 'inline-flex items-center gap-1.5 rounded px-2 py-1 text-muted-foreground text-xs hover:bg-accent disabled:opacity-60'
      }
    >
      {t('editor.bibliography.toggle')}
      <span
        aria-label={t('editor.bibliography.count', { count: citationCount })}
        className={
          citationCount > 0
            ? 'inline-flex min-w-4 items-center justify-center rounded-full bg-background px-1 font-medium text-[10px] text-foreground'
            : 'inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] opacity-50'
        }
      >
        {citationCount}
      </span>
    </button>
  );
```

### Step 3.4 — Pass the live count from the editor

Edit `src/components/editor/editor.tsx`. The component already holds `editor` and `citationStyle`. Locate the `<BibliographyToggle …/>` mount (lines 579-583):

```tsx
            <BibliographyToggle
              pageId={pageId}
              initialDisabled={initialDisableBibliography}
              onChange={setBibDisabled}
            />
```

Replace it with (derive the count inline from the same `editor.getJSON()` + `citationStyle` the `<Bibliography>` mount on line 619 uses):

```tsx
            <BibliographyToggle
              pageId={pageId}
              initialDisabled={initialDisableBibliography}
              citationCount={
                editor ? aggregateCitations(editor.getJSON(), citationStyle).length : 0
              }
              onChange={setBibDisabled}
            />
```

Add the import. Near the other `@/lib/citations/*` / aggregate imports at the top of `editor.tsx`, add:

```ts
import { aggregateCitations } from '@/lib/citations/aggregate';
```

(If `aggregateCitations` is already imported in `editor.tsx`, skip this line — Biome will flag a duplicate import. Verify with `grep -n "aggregateCitations" src/components/editor/editor.tsx` before adding.)

### Step 3.5 — Add the count i18n keys

In `messages/en.json`, after `"editor.bibliography.toggleHint": …` (line 315):

```json
  "editor.bibliography.count": "{count} citations",
  "editor.bibliography.count.one": "{count} citation",
  "editor.bibliography.count.other": "{count} citations",
```

In `messages/es.json`, after the matching `editor.bibliography.toggleHint`:

```json
  "editor.bibliography.count": "{count} citas",
  "editor.bibliography.count.one": "{count} cita",
  "editor.bibliography.count.other": "{count} citas",
```

In `messages/ar.json`, after the matching `editor.bibliography.toggleHint` (Arabic has multiple plural categories — provide zero/one/two/few/many/other so `Intl.PluralRules('ar')` resolves):

```json
  "editor.bibliography.count": "{count} اقتباسات",
  "editor.bibliography.count.zero": "لا اقتباسات",
  "editor.bibliography.count.one": "اقتباس واحد",
  "editor.bibliography.count.two": "اقتباسان",
  "editor.bibliography.count.few": "{count} اقتباسات",
  "editor.bibliography.count.many": "{count} اقتباسًا",
  "editor.bibliography.count.other": "{count} اقتباس",
```

### Step 3.6 — Verify

```sh
source ~/.zshenv && pnpm vitest run tests/lib/citations/citation-count.test.ts && pnpm typecheck && pnpm i18n:check
```

Expected: vitest PASS; typecheck exit 0; `i18n:check` exit 0 (the `.one`/`.other`/`.zero`/`.two`/`.few`/`.many` plural variants are recognized as variants of the `editor.bibliography.count` base key, not "new" missing keys — if `i18n:check` flags the per-locale plural-category asymmetry as extra/missing, that is the established pattern used elsewhere for `count`-bearing keys; mirror whatever an existing pluralized key like `recovery.codes.count` does, but at minimum every locale MUST define the `editor.bibliography.count` base key plus its locale-appropriate categories).

### Step 3.7 — Commit

```sh
git add src/components/editor/bibliography-toggle.tsx src/components/editor/editor.tsx tests/lib/citations/citation-count.test.ts messages/en.json messages/es.json messages/ar.json && git commit -m "feat(editor): show live citation count on bibliography toggle, muted at 0 (D)"
```

---

## Task 4 — (K) Unlock-authority clarity in the lock banner + i18n

The banner (`lock-banner.tsx`) is a **server component** showing `Locked by {name}` + remaining time. Add an explicit authority line: when the viewer is the lock owner or an admin → "You can unlock this page"; otherwise → "Only {name} or an admin can unlock". All strings move to i18n keys, resolved server-side via the established `cookies()`/`headers()`/`resolveLocale`/`getMessages`/`createT` pattern.

### Step 4.1 — Write the failing test

Create `tests/lib/i18n/lock-banner-strings.test.ts` (a pure string/branching test — the server component itself depends on DB + RSC, so we test the i18n keys + the authority-branch decision in isolation):

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createT } from '@/lib/i18n/t';
import { getMessages } from '@/lib/i18n/messages';

// Mirrors the authority branch the LockBanner will compute.
function authorityKey(canUnlock: boolean): 'lock.banner.youCanUnlock' | 'lock.banner.adminCanUnlock' {
  return canUnlock ? 'lock.banner.youCanUnlock' : 'lock.banner.adminCanUnlock';
}

describe('lock banner authority strings (finding K)', () => {
  it('defines the three new keys in every locale', () => {
    for (const locale of ['en', 'es', 'ar'] as const) {
      const t = createT(locale, getMessages(locale));
      expect(t('lock.banner.lockedBy', { name: 'Ada' })).not.toBe('lock.banner.lockedBy');
      expect(t('lock.banner.youCanUnlock')).not.toBe('lock.banner.youCanUnlock');
      expect(t('lock.banner.adminCanUnlock', { name: 'Ada' })).not.toBe(
        'lock.banner.adminCanUnlock',
      );
    }
  });

  it('interpolates the locker name into the "locked by" + admin strings', () => {
    const t = createT('en', getMessages('en'));
    expect(t('lock.banner.lockedBy', { name: 'Ada' })).toContain('Ada');
    expect(t('lock.banner.adminCanUnlock', { name: 'Ada' })).toContain('Ada');
  });

  it('routes the authority branch by canUnlock', () => {
    expect(authorityKey(true)).toBe('lock.banner.youCanUnlock');
    expect(authorityKey(false)).toBe('lock.banner.adminCanUnlock');
  });
});
```

### Step 4.2 — Run to fail

```sh
source ~/.zshenv && pnpm vitest run tests/lib/i18n/lock-banner-strings.test.ts
```

Expected: FAIL — `t('lock.banner.youCanUnlock')` returns the key itself (`'lock.banner.youCanUnlock'`) because the keys don't exist yet, so `.not.toBe(...)` fails.

### Step 4.3 — Add the i18n keys

In `messages/en.json`, after the `editor.bibliography.*` block added in Task 3 (or anywhere in the file — placement is cosmetic; group near other page keys):

```json
  "lock.banner.lockedBy": "Locked by {name}",
  "lock.banner.autoUnlock": "auto-unlocks in {duration}",
  "lock.banner.indefinite": "indefinite",
  "lock.banner.youCanUnlock": "You can unlock this page.",
  "lock.banner.adminCanUnlock": "Only {name} or an admin can unlock it.",
```

In `messages/es.json`:

```json
  "lock.banner.lockedBy": "Bloqueado por {name}",
  "lock.banner.autoUnlock": "se desbloquea automáticamente en {duration}",
  "lock.banner.indefinite": "indefinido",
  "lock.banner.youCanUnlock": "Puedes desbloquear esta página.",
  "lock.banner.adminCanUnlock": "Solo {name} o un administrador puede desbloquearla.",
```

In `messages/ar.json`:

```json
  "lock.banner.lockedBy": "مقفل بواسطة {name}",
  "lock.banner.autoUnlock": "يُفتح تلقائيًا خلال {duration}",
  "lock.banner.indefinite": "غير محدد",
  "lock.banner.youCanUnlock": "يمكنك إلغاء قفل هذه الصفحة.",
  "lock.banner.adminCanUnlock": "يمكن فقط لـ {name} أو لمسؤول إلغاء قفلها.",
```

### Step 4.4 — Rewrite the banner to use server-side `t` + authority line

Edit `src/components/pages/lock-banner.tsx`.

Replace the import block (lines 12-17):

```ts
import { eq } from 'drizzle-orm';
import { Lock } from 'lucide-react';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { isLocked } from '@/lib/pages/lock';
import { UnlockButton } from './lock-toggle';
```

with:

```ts
import { eq } from 'drizzle-orm';
import { Lock } from 'lucide-react';
import { cookies, headers } from 'next/headers';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getMessages } from '@/lib/i18n/messages';
import { resolveLocale } from '@/lib/i18n/resolve';
import { createT } from '@/lib/i18n/t';
import { isLocked } from '@/lib/pages/lock';
import { UnlockButton } from './lock-toggle';
```

Replace the body of `LockBanner` from `const state = await isLocked(...)` through the `return (...)` (lines 41-76). Keep the `formatRelative` helper (lines 25-34) unchanged — it produces the `{duration}` value. New body:

```ts
  const state = await isLocked(getDb(), pageId);
  if (!state.locked) return null;

  const cookieStore = await cookies();
  const hdrs = await headers();
  const locale = resolveLocale(
    cookieStore.get('NEXT_LOCALE')?.value,
    hdrs.get('accept-language'),
  );
  const t = createT(locale, getMessages(locale));

  let lockerName = t('lock.banner.anEditor');
  if (state.lockedBy) {
    const [row] = await getDb()
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, state.lockedBy))
      .limit(1);
    if (row?.name) lockerName = row.name;
  }

  const isSelfLocker = state.lockedBy === viewerUserId;
  const canUnlock = isSelfLocker || viewerIsAdmin;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950"
    >
      <Lock className="h-4 w-4 text-amber-700 dark:text-amber-300" aria-hidden />
      <span className="min-w-0 flex-1">
        {t('lock.banner.lockedBy', { name: lockerName })}
        {state.lockedUntil ? (
          <> · {t('lock.banner.autoUnlock', { duration: formatRelative(state.lockedUntil) })}</>
        ) : (
          <> · {t('lock.banner.indefinite')}</>
        )}
        {' · '}
        {canUnlock
          ? t('lock.banner.youCanUnlock')
          : t('lock.banner.adminCanUnlock', { name: lockerName })}
      </span>
      {canUnlock && (
        <UnlockButton pageId={pageId} isAdminOverride={!isSelfLocker && viewerIsAdmin} />
      )}
    </div>
  );
```

Add the `lock.banner.anEditor` fallback key (the old hardcoded `'an editor'` default). In `messages/en.json`:

```json
  "lock.banner.anEditor": "an editor",
```

In `messages/es.json`:

```json
  "lock.banner.anEditor": "un editor",
```

In `messages/ar.json`:

```json
  "lock.banner.anEditor": "أحد المحررين",
```

### Step 4.5 — Run to pass + verify

```sh
source ~/.zshenv && pnpm vitest run tests/lib/i18n/lock-banner-strings.test.ts && pnpm typecheck && pnpm lint && pnpm i18n:check
```

Expected: vitest PASS (all three keys defined in every locale + interpolation + branch routing); typecheck exit 0; lint 0 errors; `i18n:check` exit 0.

### Step 4.6 — Commit

```sh
git add src/components/pages/lock-banner.tsx tests/lib/i18n/lock-banner-strings.test.ts messages/en.json messages/es.json messages/ar.json && git commit -m "feat(lock): add unlock-authority clarity to lock banner with i18n (K)"
```

---

## Task 5 — (L) Deep-test DOI lookup: happy path + bad-DOI 502 error path

The route (`src/app/api/citations/lookup/route.ts`) maps an upstream throw to a generic 502 (lines 61-68). The existing test (`tests/lib/citations/route.test.ts`) covers 200/400/401 but **not** the 502 upstream-failure path. Add the error-path assertion plus a fuller happy-path metadata assertion that mirrors the end-to-end flow (paste DOI → lookup → metadata → preview-able formatted strings). If the route does not actually return 502 on an upstream throw, fix it (it currently does — this test pins it).

### Step 5.1 — Write the failing test

Edit `tests/lib/citations/route.test.ts`. The top-level `vi.mock('@/lib/citations/lookup', …)` (lines 13-27) hardcodes successful resolves, so per-test override of `lookupDoi` to reject is needed. Replace that mock block with a mutable-implementation form:

Replace (lines 13-27):

```ts
vi.mock('@/lib/citations/lookup', () => ({
  lookupDoi: vi.fn(async () => ({
    source: 'doi' as const,
    authors: [{ family: 'Doe', given: 'J' }],
    title: 'T',
    year: 2024,
  })),
  lookupPubmed: vi.fn(async () => ({
    source: 'pubmed' as const,
    authors: [{ family: 'Doe', given: 'J' }],
    title: 'P',
    year: 2024,
    pmid: '99',
  })),
}));
```

with:

```ts
vi.mock('@/lib/citations/lookup', () => ({
  lookupDoi: vi.fn(),
  lookupPubmed: vi.fn(),
}));

const DOI_META = {
  source: 'doi' as const,
  authors: [{ family: 'Doe', given: 'J' }],
  title: 'T',
  year: 2024,
};
const PUBMED_META = {
  source: 'pubmed' as const,
  authors: [{ family: 'Doe', given: 'J' }],
  title: 'P',
  year: 2024,
  pmid: '99',
};
```

In the existing `beforeEach` (lines 29-34), after the `cfg.__set(...)` line, reset the lookup mocks to their default happy behavior:

```ts
beforeEach(async () => {
  const cfg = (await import('@/lib/auth/config')) as unknown as {
    __set: (s: { user: { id: string } } | null) => void;
  };
  cfg.__set({ user: { id: 'u1' } });
  const lookup = (await import('@/lib/citations/lookup')) as unknown as {
    lookupDoi: ReturnType<typeof vi.fn>;
    lookupPubmed: ReturnType<typeof vi.fn>;
  };
  lookup.lookupDoi.mockImplementation(async () => DOI_META);
  lookup.lookupPubmed.mockImplementation(async () => PUBMED_META);
});
```

Add two new `it` blocks inside `describe('GET /api/citations/lookup', …)`, after the existing `401s when unauthenticated` test (after line 88, before the closing `});`):

```ts
  it('happy path: paste DOI → 200 with meta + APA/MLA/Chicago formatted (finding L)', async () => {
    const { GET } = await import('@/app/api/citations/lookup/route');
    const req = new Request('http://x/api/citations/lookup?doi=10.1234/abc');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      meta: { source: string; title: string; year?: number };
      formatted: { apa: string; mla: string; chicago: string };
    };
    expect(body.meta.source).toBe('doi');
    expect(body.meta.title).toBe('T');
    // All three styles are non-empty so the dialog preview + Insert work.
    expect(body.formatted.apa.length).toBeGreaterThan(0);
    expect(body.formatted.mla.length).toBeGreaterThan(0);
    expect(body.formatted.chicago.length).toBeGreaterThan(0);
  });

  it('error path: bad DOI → upstream throw → generic 502 (finding L)', async () => {
    const lookup = (await import('@/lib/citations/lookup')) as unknown as {
      lookupDoi: ReturnType<typeof vi.fn>;
    };
    lookup.lookupDoi.mockImplementationOnce(async () => {
      throw new Error('crossref: 404 Not Found');
    });
    const { GET } = await import('@/app/api/citations/lookup/route');
    const req = new Request('http://x/api/citations/lookup?doi=10.9999/does-not-exist');
    const res = await GET(req);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('lookup failed');
    // The generic message must NOT leak the upstream error detail.
    expect(JSON.stringify(body)).not.toContain('crossref');
    expect(JSON.stringify(body)).not.toContain('404');
  });
```

### Step 5.2 — Run to fail

```sh
source ~/.zshenv && pnpm vitest run tests/lib/citations/route.test.ts
```

Expected: the **existing** 200/pubmed/400/401 tests still pass (the mock now resolves via `beforeEach`). The new 502 test asserts the error-path. If the route already returns 502 with `{error: 'lookup failed'}`, the test passes immediately — run-to-fail here is the safety net: if `mockImplementationOnce` is not respected (e.g. mock wiring wrong) the test fails first. If the new tests are GREEN on first run, the route already behaves correctly; the test now LOCKS that behavior. If they are RED for a real reason, go to Step 5.3.

### Step 5.3 — Fix any surfaced bug (only if Step 5.2 is red for a route reason)

If the 502 test fails because the route swallowed the upstream throw or returned a non-502 status, inspect `src/app/api/citations/lookup/route.ts:56-68`. The catch block must:

```ts
  } catch (err) {
    console.error('citation lookup failed', (err as Error).message);
    return new Response(JSON.stringify({ error: 'lookup failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
```

Confirm `status: 502` and the body is the static `{ error: 'lookup failed' }` (never the raw `err.message`). If it differs, correct it to exactly the above. (Per the read of the current source this is already correct, so no edit is expected — but if the test surfaced a regression, this is the fix.)

### Step 5.4 — Run to pass

```sh
source ~/.zshenv && pnpm vitest run tests/lib/citations/route.test.ts
```

Expected: PASS — all original tests plus the new happy-path metadata assertion and the new bad-DOI → 502 (no leak) assertion green.

### Step 5.5 — Commit

```sh
git add tests/lib/citations/route.test.ts src/app/api/citations/lookup/route.ts && git commit -m "test(citations): cover DOI lookup happy path + bad-DOI 502 error path (L)"
```

(If `route.ts` was not modified in Step 5.3, drop it from the `git add` — commit only `tests/lib/citations/route.test.ts`.)

---

## Task 6 — G2 per-group gate

Run the full group gate per spec Section 4. All must pass before G2 is considered complete.

### Step 6.1 — Lint (0 errors)

```sh
source ~/.zshenv && pnpm lint
```

Expected: `Checked N files … No fixes needed.` / 0 errors. If Biome reports auto-fixable issues (import ordering, `import type`), run `pnpm biome check --write` and re-stage the touched files, then re-run `pnpm lint` to confirm 0 errors.

### Step 6.2 — Typecheck

```sh
source ~/.zshenv && pnpm typecheck
```

Expected: exit 0, no `tsc` diagnostics.

### Step 6.3 — i18n check (no new orphans)

```sh
source ~/.zshenv && pnpm i18n:check
```

Expected: exit 0 — every new key (`cover.preset.{roseQuartz,cobaltFade,charcoal,walnut}`, `editor.bibliography.count*`, `lock.banner.*`) exists in en/es/ar with no missing/extra reported.

### Step 6.4 — Group vitest

```sh
source ~/.zshenv && pnpm vitest run tests/lib/pages/cover-presets.test.ts tests/lib/color/title-contrast.test.ts tests/lib/citations/citation-count.test.ts tests/lib/citations/route.test.ts tests/lib/i18n/lock-banner-strings.test.ts
```

Expected: all 5 files green, 0 failures.

### Step 6.5 — Build

```sh
source ~/.zshenv && pnpm build; echo "BUILD_EXIT=$?"
```

Expected: `BUILD_EXIT=0`. (Per the v0.9.7 fix the in-build TS phase is skipped; types are gated by Step 6.2. A `137`/`SIGKILL`/OOM is CI-runner flake per spec Section 5 — re-run, do not "fix".)

### Step 6.6 — Final group commit (if the gate produced any formatting fixups)

If Steps 6.1–6.5 produced no new changes, there is nothing to commit and G2 is done. If `pnpm biome check --write` reformatted files in Step 6.1:

```sh
git add -A && git commit -m "chore(g2): biome formatting fixups for editor/cover/citation polish gate"
```

G2 (audit items C, D, K, L) complete.

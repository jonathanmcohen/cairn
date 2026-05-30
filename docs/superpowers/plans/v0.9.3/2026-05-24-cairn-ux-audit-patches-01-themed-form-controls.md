# P01 — Themed Form Controls (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace audit-scoped native form controls (`<select>`, `<input type="date">`) with themed, dark-mode-correct components, starting by adding reusable `Select` and `DateField` primitives to `src/components/ui/`.

**Architecture:** Build a `Select` primitive on the already-installed unified `radix-ui` package (`import { Select as SelectPrimitive } from 'radix-ui'`) — a custom-rendered listbox that the OS cannot un-theme. Build a lightweight `DateField` wrapper around the shadcn `Input` that normalizes styling and exposes a clear label. Then migrate the four audit-scoped instances (#12 locale, #18 my-tasks due, #19 notifications status, #20 notifications dates). Remaining site-wide native controls (databases/admin/connectors) are tracked under #38 as explicit follow-up — this plan logs them, it does not migrate them all.

**Tech Stack:** React 19, `radix-ui` 1.4.3, Tailwind v4, `cn()` from `src/lib/utils.ts`.

**Covers:** GH #38 (cross-cutting umbrella), #21 (audit 12), #27 (audit 18), #28 (audit 19), #29 (audit 20).

---

### Task 1: Add the `Select` UI primitive

**Files:**
- Create: `src/components/ui/select.tsx`
- Test: `tests/components/ui/select.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

afterEach(cleanup);

describe('<Select>', () => {
  it('renders the trigger with the placeholder and a themed class', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Status">
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">Open</SelectItem>
        </SelectContent>
      </Select>,
    );
    const trigger = screen.getByrole('combobox', { name: 'Status' });
    expect(trigger).toBeTruthy();
    expect(trigger.className).toContain('bg-background');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/ui/select.test.tsx`
Expected: FAIL — module `@/components/ui/select` not found.

- [ ] **Step 3: Implement the primitive**

```tsx
'use client';

import { Check, ChevronDown } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-9 min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-60" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out',
        position === 'popper' && 'data-[side=bottom]:translate-y-1',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = 'SelectContent';

const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = 'SelectItem';

export { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue };
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/ui/select.test.tsx`
Expected: PASS. If `bg-popover`/`popover-foreground` tokens are undefined, confirm they exist in `src/app/globals.css` `@theme`; if absent, add `--color-popover`/`--color-popover-foreground` mapping to the existing surface tokens (reuse `--color-card`/`--color-card-foreground` values) — verify by grepping globals.css before adding.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/select.tsx tests/components/ui/select.test.tsx
git commit -m "feat(ui): add themed Select primitive (radix-ui) — refs #38"
```

---

### Task 2: Add the `DateField` UI primitive

**Files:**
- Create: `src/components/ui/date-field.tsx`
- Test: `tests/components/ui/date-field.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DateField } from '@/components/ui/date-field';

afterEach(cleanup);

describe('<DateField>', () => {
  it('renders a date input with the given value and label', () => {
    render(<DateField label="Due by" value="2026-05-24" onChange={() => {}} />);
    const input = screen.getByLabelText('Due by') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.value).toBe('2026-05-24');
    expect(input.className).toContain('rounded-md');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/ui/date-field.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type DateFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  hideLabel?: boolean;
};

export function DateField({ label, value, onChange, id, className, hideLabel }: DateFieldProps) {
  const reactId = React.useId();
  const inputId = id ?? reactId;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        htmlFor={inputId}
        className={cn('text-xs font-medium text-muted-foreground', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <Input
        id={inputId}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // dark-mode: invert the native calendar glyph so it is visible on dark bg
        className="[color-scheme:light] dark:[color-scheme:dark]"
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/ui/date-field.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/date-field.tsx tests/components/ui/date-field.test.tsx
git commit -m "feat(ui): add themed DateField primitive — refs #38"
```

---

### Task 3: Migrate the locale switcher (#21 / audit 12)

**Files:**
- Modify: `src/components/locale-switcher.tsx`
- Test: `tests/components/locale-switcher-es.test.tsx` (exists — keep passing)

- [ ] **Step 1: Replace the native `<select>` with the `Select` primitive**

Replace the returned JSX in `src/components/locale-switcher.tsx` with:

```tsx
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t('locale.label')}</span>
      <Select value={locale} onValueChange={(next) => setLocale(next as Locale)}>
        <SelectTrigger aria-label={t('locale.label')} className="min-h-11 w-auto min-w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LOCALES.map((loc) => (
            <SelectItem key={loc} value={loc}>
              {t(`locale.${loc}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
```

Add the import at the top:

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
```

- [ ] **Step 2: Update the existing locale test if it asserts on `<select>`**

Read `tests/components/locale-switcher-es.test.tsx`. If it queries a `<select>`/`<option>` by role, switch the assertion to the trigger (`getByRole('combobox')`) showing the active locale label. Keep the test's intent (renders ES label when locale=es).

- [ ] **Step 3: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/locale-switcher-es.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/locale-switcher.tsx tests/components/locale-switcher-es.test.tsx
git commit -m "fix(i18n): themed locale switcher dropdown (dark-mode safe) — Closes #21"
```

---

### Task 4: Migrate the `/my-tasks` due-by date input (#27 / audit 18)

**Files:**
- Modify: `src/app/(app)/my-tasks/tasks-table.tsx` (~L73-79)

- [ ] **Step 1: Replace the native date input with `DateField`**

Import `import { DateField } from '@/components/ui/date-field';`. Replace the `<Input type="date" …>` block (the "Due by" filter, ~L74) with:

```tsx
        <DateField
          label="Due by"
          hideLabel
          value={due ?? ''}
          onChange={(next) => updateDue(next)}
        />
```

Preserve the existing change handler logic (whatever currently runs on the date input's `onChange` — wire it through `onChange`). Do not change the query-param behavior.

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/ -t "tasks" ; pnpm lint && pnpm typecheck`
Expected: existing my-tasks tests pass; clean lint/types. (Filter polish is P05 — only the control swap here.)

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/my-tasks/tasks-table.tsx
git commit -m "fix(my-tasks): themed due-by date control — Closes #27"
```

---

### Task 5: Migrate the `/notifications` status select + From/To dates (#28, #29 / audit 19, 20)

**Files:**
- Modify: `src/components/notifications/page-list.tsx` (status `<select>` ~L155; date inputs ~L204, L223)

- [ ] **Step 1: Replace the status `<select>`**

Import `Select`+parts and `DateField`. Replace the status `<select id={statusId}>` (~L151-167) with:

```tsx
        <Select value={status} onValueChange={(next) => setStatus(next as StatusFilter)}>
          <SelectTrigger id={statusId} aria-label="Status" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="unread">Unread</SelectItem>
            <SelectItem value="read">Read</SelectItem>
          </SelectContent>
        </Select>
```

Match the existing state variable/handler names (read them in-file first; `status`/`setStatus` are placeholders — use the real ones).

- [ ] **Step 2: Replace From/To date inputs**

Replace each `<Input id={fromId|toId} type="date" …>` with:

```tsx
        <DateField label="From" value={dateFrom ?? ''} onChange={setDateFrom} id={fromId} />
        {/* …and: */}
        <DateField label="To" value={dateTo ?? ''} onChange={setDateTo} id={toId} />
```

Use the real state setters from the file.

- [ ] **Step 3: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/notifications ; pnpm lint && pnpm typecheck && pnpm build`
Expected: notification tests pass; build clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/notifications/page-list.tsx
git commit -m "fix(notifications): themed status dropdown + date filters — Closes #28 Closes #29"
```

---

### Task 6: Log remaining native-control instances as #38 follow-up

**Files:**
- Modify: GitHub issue #38 (via `gh issue comment`)

- [ ] **Step 1: Post the inventory comment so the umbrella issue tracks what remains**

```bash
gh issue comment 38 --body "Audit-scoped instances migrated in branch \`patches/ux-audit-v0.9.2\`: locale switcher (#21), /my-tasks due (#27), /notifications status + dates (#28, #29). Remaining native \`<select>\`/\`type=date\` (databases, admin, connectors, automation, cell-editor, share-panel, datetime block, audit-viewer) are out of audit scope and tracked here as follow-up — migrate to the new \`ui/select\` + \`ui/date-field\` primitives in a later pass."
```

- [ ] **Step 2: Close #38 only if the user wants the umbrella closed**

Leave #38 open (it tracks the broader migration). The PR closes #21/#27/#28/#29 via commit trailers; #38 stays open with the inventory comment.

---

## Self-Review

- Spec coverage: #21, #27, #28, #29 migrated; #38 tracked + commented. ✓
- New primitives are reusable (P05/P06 depend on them). ✓
- No placeholders left except where the plan explicitly says "use the real state-variable names in-file" — the implementer must read the file first. ✓

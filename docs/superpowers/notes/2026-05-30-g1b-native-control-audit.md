# G1b native-form-control audit (#38) — 2026-05-30

Re-run the audit:

```sh
rg -l '<select' src/ -g '!*.test.*' | sort        # raw native selects
rg -n 'type="(date|time|datetime-local)"' src/ -g '!*.test.*'
rg -n 'type="(color|range)"' src/ -g '!*.test.*'  # expect: none
```

## In scope (converted in plan G1b)
Native `<select>` → themed `Select`; native `<input type="date">` → themed `DateField`.
21 files / 33 selects + 4 date inputs. See the plan doc for the per-file task list.

## Out of scope (no themed primitive exists)
- `type="checkbox" | "radio" | "file"` — no `ui/checkbox|switch|radio|file` primitive.
- `type="number" | "text"` inline cell editors.
- `type="time"` in `editor/extensions/datetime.tsx` — no themed time primitive; the
  control adopts the `Input` primitive classes but stays `type="time"`. The CI guard
  (tests/components/native-control-guard.test.ts) allows `type="time"`.

## Lock-in
`tests/components/native-control-guard.test.ts` fails CI if a raw `<select` or a
native `type="date"`/`type="datetime-local"` reappears under `src/` outside
`src/components/ui/`.

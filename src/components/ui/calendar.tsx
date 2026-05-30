'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A small, dependency-free themed month grid. Renders day cells as buttons and
 * emits the picked day as an ISO `YYYY-MM-DD` string. All dates are handled in
 * UTC so the emitted string never drifts by a day across timezones.
 *
 * This is intentionally minimal (no range/multi-select) — it backs `DateField`,
 * replacing the OS-native `<input type="date">` picker (#29) with fully themed
 * markup that looks identical in light + dark mode.
 */
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function toIso(year: number, monthIndex: number, day: number): string {
  const mm = String(monthIndex + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Parse a YYYY-MM-DD string to {year, monthIndex, day} or null. */
export function parseIsoDate(value: string): { year: number; monthIndex: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  return { year, monthIndex, day };
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function Calendar({
  value,
  onSelect,
  className,
}: {
  value: string;
  onSelect: (iso: string) => void;
  className?: string;
}) {
  const selected = parseIsoDate(value);
  const today = new Date();
  const initial = selected ?? {
    year: today.getUTCFullYear(),
    monthIndex: today.getUTCMonth(),
    day: today.getUTCDate(),
  };
  const [view, setView] = React.useState({ year: initial.year, monthIndex: initial.monthIndex });

  const firstWeekday = new Date(Date.UTC(view.year, view.monthIndex, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(view.year, view.monthIndex + 1, 0)).getUTCDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function shiftMonth(delta: number) {
    setView((v) => {
      const next = new Date(Date.UTC(v.year, v.monthIndex + delta, 1));
      return { year: next.getUTCFullYear(), monthIndex: next.getUTCMonth() };
    });
  }

  return (
    <div className={cn('w-64 select-none p-2', className)}>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          className="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent"
          onClick={() => shiftMonth(-1)}
        >
          <ChevronLeft aria-hidden className="size-4" />
        </button>
        <span className="font-medium text-sm">
          {MONTH_NAMES[view.monthIndex]} {view.year}
        </span>
        <button
          type="button"
          aria-label="Next month"
          className="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent"
          onClick={() => shiftMonth(1)}
        >
          <ChevronRight aria-hidden className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-muted-foreground text-xs">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (day === null) {
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-position blank pad cell
            return <span key={`pad-${i}`} className="size-8" />;
          }
          const isSelected =
            selected != null &&
            selected.year === view.year &&
            selected.monthIndex === view.monthIndex &&
            selected.day === day;
          return (
            <button
              key={day}
              type="button"
              aria-pressed={isSelected}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-md text-sm hover:bg-accent',
                isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
              onClick={() => onSelect(toIso(view.year, view.monthIndex, day))}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

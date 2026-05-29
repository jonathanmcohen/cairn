'use client';

import { CalendarIcon } from 'lucide-react';
import { Popover } from 'radix-ui';
import * as React from 'react';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

type DateFieldProps = {
  label: string;
  value: string; // ISO YYYY-MM-DD ('' = unset)
  onChange: (value: string) => void; // emits ISO YYYY-MM-DD
  id?: string;
  className?: string;
  hideLabel?: boolean;
};

/**
 * #29: a fully themed date control. The trigger is a real <button> that opens a
 * radix Popover containing a self-rendered calendar grid — NOT a native
 * `<input type="date">`. This removes the OS-native picker/spinner/glyph that
 * looked off-theme and broke in dark mode, and fixes #29 for every DateField
 * call site at once. Public props are unchanged so call sites don't move;
 * value/onChange stay ISO `YYYY-MM-DD` strings.
 */
export function DateField({ label, value, onChange, id, className, hideLabel }: DateFieldProps) {
  const reactId = React.useId();
  const fieldId = id ?? reactId;
  const labelId = `${fieldId}-label`;
  const [open, setOpen] = React.useState(false);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span
        id={labelId}
        className={cn('font-medium text-muted-foreground text-xs', hideLabel && 'sr-only')}
      >
        {label}
      </span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          id={fieldId}
          type="button"
          aria-labelledby={`${labelId} ${fieldId}`}
          className="inline-flex min-h-11 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className={cn(!value && 'text-muted-foreground')}>{value || 'Pick a date'}</span>
          <CalendarIcon aria-hidden className="size-4 shrink-0 opacity-60" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-50 rounded-md border bg-popover text-popover-foreground shadow-md"
          >
            <Calendar
              value={value}
              onSelect={(iso) => {
                onChange(iso);
                setOpen(false);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

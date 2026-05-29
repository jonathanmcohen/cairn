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

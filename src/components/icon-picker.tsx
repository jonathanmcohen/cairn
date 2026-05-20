'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';

export type IconPickerProps = {
  value: string | null;
  onChange: (next: string | null) => void;
};

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Lazy-import the web component only when needed (it registers a <emoji-picker>).
    void import('emoji-picker-element').then(() => {
      if (cancelled || !containerRef.current) return;
      const picker = document.createElement('emoji-picker') as HTMLElement & {
        addEventListener: (
          event: 'emoji-click',
          handler: (e: CustomEvent<{ unicode: string }>) => void,
        ) => void;
      };
      picker.addEventListener('emoji-click', (e) => {
        onChange(e.detail.unicode);
        setOpen(false);
      });
      containerRef.current.replaceChildren(picker);
    });
    return () => {
      cancelled = true;
    };
  }, [open, onChange]);

  return (
    <div className="relative inline-block">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change icon"
        className="h-10 w-10 text-3xl"
      >
        {value ?? '📄'}
      </Button>
      {open && (
        <div
          ref={containerRef}
          className="absolute left-0 z-10 mt-2 rounded-md border bg-background shadow-lg"
        />
      )}
    </div>
  );
}

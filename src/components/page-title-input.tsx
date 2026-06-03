'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/provider';

export type PageTitleInputProps = {
  pageId: string;
  initial: string;
};

export function PageTitleInput({ pageId, initial }: PageTitleInputProps) {
  const t = useT();
  const [value, setValue] = useState(initial);
  const [savedValue, setSavedValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  // v0.9.9 K1 #215/#206 — when NewPageButton routes here with ?new=1 the page
  // is brand-new and title-less; autofocus + select-all so the user can name it
  // immediately, and surface a template nudge while the title is still blank.
  const isNew = searchParams?.get('new') === '1';

  useEffect(() => {
    if (isNew && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isNew]);

  async function save(next: string) {
    if (next === savedValue || next.trim() === '') return;
    const res = await fetch(`/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: next }),
    });
    if (res.ok) setSavedValue(next);
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className="w-full bg-transparent text-3xl font-semibold outline-hidden focus:ring-0"
        placeholder={t('page.title.placeholder')}
      />
      {isNew && value.trim() === '' ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {t('page.title.nudge')}{' '}
          <Link href={'/templates/gallery' as Route} className="underline underline-offset-2">
            {t('page.title.fromTemplate')}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

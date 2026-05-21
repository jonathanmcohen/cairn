'use client';

import { useState } from 'react';

export type PageTitleInputProps = {
  pageId: string;
  initial: string;
};

export function PageTitleInput({ pageId, initial }: PageTitleInputProps) {
  const [value, setValue] = useState(initial);
  const [savedValue, setSavedValue] = useState(initial);

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
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className="w-full bg-transparent text-3xl font-semibold outline-hidden focus:ring-0"
      placeholder="Untitled"
    />
  );
}

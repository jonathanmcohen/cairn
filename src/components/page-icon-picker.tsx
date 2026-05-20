'use client';

import { useState } from 'react';
import { IconPicker } from './icon-picker';

export function PageIconPicker({ pageId, initial }: { pageId: string; initial: string | null }) {
  const [icon, setIcon] = useState<string | null>(initial);

  async function save(next: string | null) {
    setIcon(next);
    await fetch(`/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ icon: next }),
    });
  }

  return <IconPicker value={icon} onChange={(next) => void save(next)} />;
}

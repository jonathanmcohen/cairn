'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function KeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === 'n') {
        e.preventDefault();
        void (async () => {
          const res = await fetch('/api/pages', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          });
          if (res.ok) {
            const created = (await res.json()) as { id: string };
            router.push(`/pages/${created.id}` as Route);
            router.refresh();
          }
        })();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return null;
}

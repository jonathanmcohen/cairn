'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useT } from '@/lib/i18n/provider';

// Themed header bar above the Swagger UI (#146). Client component so the
// title + back link can be internationalized via useT() (the parent /api-docs
// page is an RSC and cannot call the hook).
export function ApiDocsHeader() {
  const t = useT();
  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
      <h1 className="text-lg font-semibold">{t('apiDocs.title')}</h1>
      <Link href={'/' as Route} className="text-sm underline hover:no-underline">
        ← {t('apiDocs.back')}
      </Link>
    </header>
  );
}

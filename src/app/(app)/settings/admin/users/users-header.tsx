'use client';

import { useT } from '@/lib/i18n/provider';

// Thin client header so the page title/description resolve through useT()
// (the only i18n entry point available client-side). Mirrors the federated
// admin page, which keeps all translatable copy in client components.
export function UsersHeader() {
  const t = useT();
  return (
    <header>
      <h1 className="text-xl font-semibold">{t('admin.users.title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('admin.users.description')}</p>
    </header>
  );
}

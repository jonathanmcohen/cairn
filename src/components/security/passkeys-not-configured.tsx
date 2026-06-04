'use client';

import { OPERATIONS_DOCS_URL } from '@/lib/docs-links';
import { useT } from '@/lib/i18n/provider';

export function PasskeysNotConfigured({ isAdmin }: { isAdmin: boolean }) {
  const t = useT();
  return (
    <div className="rounded-md border border-border bg-muted/40 p-4 text-sm">
      <p className="font-medium">{t('passkeys.notConfigured.title')}</p>
      <p className="mt-2 text-muted-foreground">
        {isAdmin ? t('passkeys.notConfigured.adminBody') : t('passkeys.notConfigured.userBody')}
      </p>
      {isAdmin && (
        <a className="mt-2 inline-block underline underline-offset-4" href={OPERATIONS_DOCS_URL}>
          {t('passkeys.notConfigured.adminDocs')}
        </a>
      )}
    </div>
  );
}

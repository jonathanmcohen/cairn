'use client';

import { useT } from '@/lib/i18n/provider';

export function EncryptionDisabledNotice() {
  const t = useT();
  return (
    <div className="rounded-md border border-border bg-muted/40 p-4 text-sm">
      <p className="font-medium">{t('e2ee.disabledTitle')}</p>
      <p className="mt-2 text-muted-foreground">{t('e2ee.disabledBody')}</p>
      <a
        className="mt-2 inline-block underline underline-offset-4"
        href="https://github.com/jonathanmcohen/cairn/blob/main/docs/admin/e2e-encryption.md"
      >
        {t('e2ee.docsLink')}
      </a>
    </div>
  );
}

'use client';

import { useT } from '@/lib/i18n/provider';

/**
 * Informational notice shown when E2EE is disabled in the build.
 *
 * `hideTitle` lets a caller that already renders `e2ee.disabledTitle` as its own
 * heading (e.g. `E2EEnrollCard`'s `<h2>`) suppress the duplicate title line.
 * Standalone callers (admin encryption page) keep the title.
 */
export function EncryptionDisabledNotice({ hideTitle = false }: { hideTitle?: boolean }) {
  const t = useT();
  return (
    <div className="rounded-md border border-border bg-muted/40 p-4 text-sm">
      {hideTitle ? null : <p className="font-medium">{t('e2ee.disabledTitle')}</p>}
      <p className={hideTitle ? 'text-muted-foreground' : 'mt-2 text-muted-foreground'}>
        {t('e2ee.disabledBody')}
      </p>
      <a
        className="mt-2 inline-block underline underline-offset-4"
        href="https://github.com/jonathanmcohen/cairn/blob/main/docs/admin/e2e-encryption.md"
      >
        {t('e2ee.docsLink')}
      </a>
    </div>
  );
}

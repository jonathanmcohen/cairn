'use client';

import { Info } from 'lucide-react';
import { useT } from '@/lib/i18n/provider';

/**
 * Informational notice shown when E2EE is disabled in the build.
 *
 * v0.10.2 P13 — styled with the semantic `--info` token pair (info-blue), not
 * warning amber or neutral gray: env-config-off is expected state, not an
 * error, but it is actionable information rather than mere chrome.
 *
 * `hideTitle` lets a caller that already renders `e2ee.disabledTitle` as its own
 * heading (e.g. `E2EEnrollCard`'s `<h2>`) suppress the duplicate title line.
 * Standalone callers (admin encryption page) keep the title.
 */
export function EncryptionDisabledNotice({ hideTitle = false }: { hideTitle?: boolean }) {
  const t = useT();
  return (
    <div
      data-testid="encryption-disabled-notice"
      className="flex items-start gap-3 rounded-md border border-info/40 bg-info/10 p-4 text-sm"
    >
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
      <div>
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
    </div>
  );
}

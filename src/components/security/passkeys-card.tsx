'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

/**
 * Discoverability surface on the Security landing page. The full passkey
 * enrollment + management UI lives at /settings/security/passkeys; this card
 * just links to it so users can find it (the page was previously unlinked).
 */
export function PasskeysCard() {
  const t = useT();
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-medium">{t('security.passkeys.title')}</h2>
      <p className="text-muted-foreground text-sm">{t('security.passkeys.blurb')}</p>
      <Button asChild variant="default" className="min-h-11">
        <Link href={'/settings/security/passkeys' as Route}>{t('security.passkeys.manage')}</Link>
      </Button>
    </section>
  );
}

'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useT } from '@/lib/i18n/provider';

const KIND_KEY: Record<string, string> = {
  google_sheets: 'connectorsDb.create.kind.google_sheets',
  airtable: 'connectorsDb.create.kind.airtable',
  csv: 'connectorsDb.create.kind.csv',
};

/** Localized back-link + heading for the per-connector config page (server pages can't call useT). */
export function ConnectorConfigHeader({ kind }: { kind: string }) {
  const t = useT();
  return (
    <div className="space-y-2">
      <Link
        href={'/settings/developer/connectors' as Route}
        className="text-sm underline hover:no-underline"
      >
        {t('connectorsDb.config.back')}
      </Link>
      <h1 className="font-semibold text-2xl">
        {t('connectorsDb.config.heading')} · {t(KIND_KEY[kind] ?? kind)}
      </h1>
    </div>
  );
}

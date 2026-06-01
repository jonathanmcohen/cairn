'use client';

import { BookOpen, Download } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useT } from '@/lib/i18n/provider';

/**
 * G14 (#161) — surfaces the Swagger UI (/api-docs) and the OpenAPI spec
 * download (/openapi.json), which were built but never linked anywhere.
 * Rendered at the bottom of the Developer API-keys settings page.
 */
export function ApiDocsLinks(): React.JSX.Element {
  const t = useT();
  return (
    <div className="mt-8 flex flex-wrap gap-3 border-t pt-6">
      <Link
        href={'/api-docs' as Route}
        className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent/50"
      >
        <BookOpen aria-hidden="true" className="size-4" />
        {t('settings.nav.developer.apiDocs')}
      </Link>
      {/* /openapi.json is a route handler, not a typed page route, so use a
          plain <a>; the download attribute also requires a same-origin <a>. */}
      <a
        href="/openapi.json"
        download="cairn-openapi.json"
        className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent/50"
      >
        <Download aria-hidden="true" className="size-4" />
        {t('settings.nav.developer.downloadOpenapi')}
      </a>
    </div>
  );
}

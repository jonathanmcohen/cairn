import type { Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageIconRender } from '@/components/page-icon-render';
import { getDb } from '@/db/client';
import { env } from '@/lib/env';
import { getPublicSitePages } from '@/lib/pages/public-site';
import { getWorkspaceBrand } from '@/lib/workspaces/brand';
import { brandPrimaryStyle } from '@/lib/workspaces/brand-style';

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function PublicSitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const site = await getPublicSitePages(db, slug);
  if (!site) notFound();

  // v0.10.0 F1 — workspace brand on the public surface: the logo renders via
  // a fresh HMAC-signed URL (anonymous visitors fetch /api/files/<id>?sig=…,
  // which is its own access boundary) and the primary color applies to this
  // page's wrapper. Null brand → unchanged default render.
  const brand = await getWorkspaceBrand(db, site.workspaceId, { secret: env().AUTH_SECRET });

  // Roots = pages with no parent, or whose parent is not in the published set.
  const ids = new Set(site.pages.map((p) => p.id));
  const roots = site.pages.filter((p) => p.parentId === null || !ids.has(p.parentId));

  return (
    <div
      data-cairn-brand-scope=""
      style={brandPrimaryStyle(brand.appliedPrimary)}
      className="mx-auto max-w-3xl px-4 py-12"
    >
      {brand.logoUrl ? (
        // biome-ignore lint/performance/noImgElement: HMAC-signed expiring URL — bypasses next/image loader
        <img
          data-cairn-brand-logo=""
          src={brand.logoUrl}
          alt={site.slug}
          className="mb-8 max-h-14 w-auto max-w-xs object-contain"
        />
      ) : null}
      <nav>
        <ul className="space-y-2">
          {roots.map((p) => (
            <li key={p.id}>
              <Link
                href={`/p/${p.slug}` as Route}
                className="flex items-center gap-2 text-lg hover:underline"
              >
                {p.icon && <PageIconRender value={p.icon} size={20} />}
                {p.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

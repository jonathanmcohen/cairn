import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { getPublicSitePages } from '@/lib/pages/public-site';

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function PublicSitePageEntry({
  params,
}: {
  params: Promise<{ slug: string; pageSlug: string }>;
}) {
  const { slug, pageSlug } = await params;
  const site = await getPublicSitePages(getDb(), slug);
  if (!site) notFound();

  const page = site.pages.find((p) => p.slug === pageSlug);
  if (!page) notFound();

  // Redirect through /p so the per-page access gate is the single enforcement point.
  redirect(`/p/${pageSlug}`);
}

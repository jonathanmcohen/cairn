import { cookies, headers } from 'next/headers';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LOCALE_COOKIE } from '@/lib/i18n/config';
import { getMessages } from '@/lib/i18n/messages';
import { resolveLocale } from '@/lib/i18n/resolve';

export default async function NotFound() {
  // Server component outside the (app) client i18n provider — resolve the
  // locale the same way the root layout does and read the catalog directly.
  const cookieStore = await cookies();
  const hdrs = await headers();
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    hdrs.get('accept-language'),
  );
  const m = getMessages(locale);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
      <p className="text-6xl font-bold tracking-tight text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">This page wandered off</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page you’re looking for doesn’t exist or may have been moved.
      </p>
      <Button asChild>
        <Link href="/">Back to home</Link>
      </Button>
      {/* v0.10.2 P17 — recovery search. A plain GET form to the in-app /search
          destination: signed-in users land in search with the query applied;
          signed-out visitors hit the auth gate and continue after sign-in. NOT
          a client /api/search call — that route is session-gated and would
          hand anonymous visitors a raw error. */}
      <form action="/search" method="get" className="flex w-full max-w-sm items-center gap-2">
        <Input
          type="search"
          name="q"
          required
          placeholder={m['notFound.searchPlaceholder']}
          aria-label={m['notFound.searchLabel']}
        />
        <Button type="submit" variant="outline">
          {m['notFound.searchCta']}
        </Button>
      </form>
    </main>
  );
}

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function NotFound() {
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
          hand anonymous visitors a raw error. This file renders outside the
          (app) i18n shell (no session/locale context), so copy stays static
          English like the rest of the page. */}
      <form action="/search" method="get" className="flex w-full max-w-sm items-center gap-2">
        <Input
          type="search"
          name="q"
          required
          placeholder="Search pages…"
          aria-label="Search pages"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
    </main>
  );
}

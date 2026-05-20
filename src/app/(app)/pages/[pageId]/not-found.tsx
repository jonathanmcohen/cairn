import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="max-w-md py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted-foreground">
        This page doesn't exist or you don't have access to it.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm underline">
        Back to workspace
      </Link>
    </div>
  );
}

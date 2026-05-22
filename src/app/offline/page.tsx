export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-semibold">You&rsquo;re offline</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        Cairn can&rsquo;t reach the server right now. Check your connection and try again — any
        changes you made while offline will sync once you&rsquo;re back online.
      </p>
    </div>
  );
}

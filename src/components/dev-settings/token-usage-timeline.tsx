'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type UsageEvent = {
  id: string;
  route: string;
  status: number;
  mcpTool: string | null;
  createdAt: string;
};

export function TokenUsageTimeline({ tokenId }: { tokenId: string }) {
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBusy(true);
      try {
        const params = new URLSearchParams({ limit: '25' });
        if (cursor) params.set('cursor', cursor);
        const r = await fetch(`/api/dev/tokens/${tokenId}/usage?${params.toString()}`);
        if (!r.ok) {
          setError('Could not load usage.');
          return;
        }
        const body = (await r.json()) as { events: UsageEvent[]; nextCursor: string | null };
        if (cancelled) return;
        setEvents((cur) => (cursor ? [...cur, ...body.events] : body.events));
        setNextCursor(body.nextCursor);
      } finally {
        setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [tokenId, cursor]);

  return (
    <div className="space-y-2">
      <h3 className="font-medium text-sm">Usage</h3>
      {events.length === 0 && !busy ? (
        <p className="text-muted-foreground text-sm">No calls yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th>Time</th>
              <th>Route</th>
              <th>Status</th>
              <th>MCP tool</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t">
                <td>{new Date(e.createdAt).toLocaleString()}</td>
                <td className="font-mono">{e.route}</td>
                <td>{e.status}</td>
                <td className="font-mono">{e.mcpTool ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {nextCursor && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCursor(nextCursor)}>
          Load more
        </Button>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

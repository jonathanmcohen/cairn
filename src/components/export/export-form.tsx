'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

type ExportResponse = { url: string; key: string; sizeBytes: number };

export function ExportForm({ workspaceId }: { workspaceId: string }) {
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<ExportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onExport = async () => {
    setWorking(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/exports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
      const body = (await res.json()) as ExportResponse;
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-3">
      <Button onClick={onExport} disabled={working}>
        {working ? 'Generating…' : 'Generate export'}
      </Button>
      {result && (
        <div className="text-sm">
          Ready ({Math.max(1, Math.round(result.sizeBytes / 1024))} KB) —{' '}
          <a href={result.url} className="text-primary underline" download>
            download from S3
          </a>{' '}
          (link expires in 5 minutes).
        </div>
      )}
      {error && <div className="text-destructive text-sm">Error: {error}</div>}
    </div>
  );
}

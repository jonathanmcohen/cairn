'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

type Target = 'mkdocs' | 'docusaurus';

export function ExportStaticSiteForm({ workspaceId }: { workspaceId: string }) {
  const [target, setTarget] = useState<Target>('mkdocs');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onGenerate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/exports/static-site', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, target }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cairn-${workspaceId.slice(0, 8)}-${target}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" aria-busy={busy}>
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Target</span>
        <select
          className="block w-full rounded border bg-background px-2 py-1"
          value={target}
          onChange={(e) => setTarget(e.target.value as Target)}
          disabled={busy}
        >
          <option value="mkdocs">MkDocs (Material)</option>
          {/* P35 unlocks docusaurus. */}
        </select>
      </label>
      <Button onClick={onGenerate} disabled={busy}>
        {busy ? 'Generating…' : 'Generate'}
      </Button>
      {busy && (
        <p className="text-muted-foreground text-sm" role="status" aria-live="polite">
          Building the project tree and bundling assets. This can take a minute on large workspaces.
        </p>
      )}
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

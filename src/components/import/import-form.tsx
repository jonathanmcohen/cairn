'use client';

import { type FormEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type Phase = 'idle' | 'uploading' | 'running' | 'done' | 'error';

type Source = 'notion' | 'markdown-folder' | 'workspace-archive';
const SOURCES: { value: Source; label: string }[] = [
  { value: 'workspace-archive', label: 'Cairn workspace archive (.zip)' },
  { value: 'notion', label: 'Notion export (.zip)' },
  { value: 'markdown-folder', label: 'Markdown folder (.zip)' },
];

type ImportReportShape = {
  source?: string;
  counts?: { pages: number; databases: number; rows: number; files: number };
  warnings?: { item: string; message: string }[];
};

export function ImportForm({ workspaceId }: { workspaceId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<Source>('workspace-archive');
  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<{ id: number; text: string }[]>([]);
  const logIdRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReportShape | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) return;
    setPhase('uploading');
    setLog([]);
    setError(null);
    setReport(null);

    const fd = new FormData();
    fd.set('file', file);
    fd.set('source', source);
    fd.set('workspaceId', workspaceId);

    let res: Response;
    try {
      res = await fetch('/api/imports', { method: 'POST', body: fd });
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'request failed');
      return;
    }
    if (!res.ok || !res.body) {
      setPhase('error');
      setError(`HTTP ${res.status}`);
      return;
    }
    setPhase('running');

    // Consume the SSE stream. SSE messages are separated by a blank line; each
    // message has zero or more `event:`/`data:` lines and optional `:` comment
    // lines (heartbeats).
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        idx = buffer.indexOf('\n\n');
        const lines = chunk.split('\n');
        let evName = 'message';
        let data = '';
        for (const line of lines) {
          if (line.startsWith(':')) continue; // heartbeat
          if (line.startsWith('event: ')) evName = line.slice(7).trim();
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (evName === 'progress') {
          try {
            const parsed = JSON.parse(data) as { phase?: string };
            if (parsed.phase) {
              const text = parsed.phase;
              logIdRef.current += 1;
              const id = logIdRef.current;
              setLog((l) => [...l, { id, text }]);
            }
          } catch {
            // ignore malformed payload
          }
        } else if (evName === 'done') {
          try {
            setReport(JSON.parse(data) as ImportReportShape);
          } catch {
            // ignore malformed payload
          }
          setPhase('done');
        } else if (evName === 'error') {
          let msg = 'unknown';
          try {
            const parsed = JSON.parse(data) as { message?: string };
            if (parsed.message) msg = parsed.message;
          } catch {
            // ignore
          }
          setError(msg);
          setPhase('error');
        }
      }
    }
  };

  const busy = phase === 'uploading' || phase === 'running';

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="import-source" className="text-sm font-medium">
          Source
        </label>
        <select
          id="import-source"
          value={source}
          onChange={(e) => setSource(e.target.value as Source)}
          className="rounded border px-2 py-1"
          disabled={busy}
        >
          {SOURCES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="import-file" className="text-sm font-medium">
          File
        </label>
        <input
          id="import-file"
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
      </div>
      <Button type="submit" disabled={!file || busy}>
        {busy ? 'Working…' : 'Import'}
      </Button>
      {log.length > 0 && (
        <ul className="text-muted-foreground space-y-0.5 text-xs">
          {log.map((entry) => (
            <li key={entry.id}>· {entry.text}</li>
          ))}
        </ul>
      )}
      {error && <div className="text-destructive text-sm">Error: {error}</div>}
      {report !== null && (
        <pre className="bg-muted overflow-auto rounded p-2 text-xs">
          {JSON.stringify(report, null, 2)}
        </pre>
      )}
    </form>
  );
}

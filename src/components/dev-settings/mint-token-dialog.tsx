'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFocusTrap } from '@/lib/a11y/focus-trap';
import { MCP_TOOL_IDS } from '@/lib/auth/mcp-tool-ids';

export type MintResult = {
  token: string;
  row: {
    id: string;
    name: string;
    tokenPrefix: string;
    scopes: string[];
    mcpTools: string[];
    expiresAt: string | null;
    createdAt: string;
  };
};

const ALL_SCOPES = [
  'pages:read',
  'pages:write',
  'pages:destructive',
  'databases:read',
  'databases:write',
  'databases:destructive',
  'comments:read',
  'comments:write',
  'comments:destructive',
  'files:read',
  'files:write',
  'files:destructive',
  'mcp:read',
  'mcp:write',
  'mcp:destructive',
  'admin',
] as const;

// Spec §2.2 / §3 G1: named presets covering the 90% of intended uses.
const PRESETS: Record<string, readonly string[]> = {
  'Read-only': ['pages:read', 'databases:read', 'comments:read', 'files:read'],
  'Full CRUD': [
    'pages:read',
    'pages:write',
    'pages:destructive',
    'databases:read',
    'databases:write',
    'databases:destructive',
    'comments:read',
    'comments:write',
    'comments:destructive',
    'files:read',
    'files:write',
    'files:destructive',
  ],
  'Write minus destructive': [
    'pages:read',
    'pages:write',
    'databases:read',
    'databases:write',
    'comments:read',
    'comments:write',
    'files:read',
    'files:write',
  ],
  'MCP read-only': ['mcp:read', 'pages:read', 'databases:read', 'comments:read', 'files:read'],
  'MCP full': [
    'mcp:read',
    'mcp:write',
    'pages:read',
    'pages:write',
    'databases:read',
    'databases:write',
    'comments:read',
    'comments:write',
    'files:read',
    'files:write',
  ],
};

// Default safe MCP-tool allowlist for the "MCP full" preset — excludes the
// destructive `*.delete` calls. The full tool registry is owned by G2 P6.
const MCP_TOOLS_SAFE_DEFAULT = MCP_TOOL_IDS.filter(
  (t) => !t.endsWith('.delete') && !t.endsWith('.delete_row'),
);

export function MintTokenDialog({
  onClose,
  onMinted,
}: {
  onClose: () => void;
  onMinted: (result: MintResult) => void;
}) {
  const nameId = useId();
  const expiryId = useId();
  const titleId = useId();
  // Trap focus inside the dialog while it's open and restore focus to the
  // previously-focused element (the "Mint new token" trigger) on close. The
  // hook also focuses the first focusable child on mount.
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(PRESETS['Read-only'] as string[]);
  const [mcpTools, setMcpTools] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState('90');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc key closes the dialog (matches the share/page-actions dialog UX).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const showMcpTools = scopes.some((s) => s.startsWith('mcp:'));

  function applyPreset(preset: keyof typeof PRESETS) {
    setScopes(PRESETS[preset] as string[]);
    setMcpTools(preset === 'MCP full' ? [...MCP_TOOLS_SAFE_DEFAULT] : []);
  }

  function toggleScope(scope: string) {
    setScopes((cur) => (cur.includes(scope) ? cur.filter((s) => s !== scope) : [...cur, scope]));
  }

  function toggleTool(tool: string) {
    setMcpTools((cur) => (cur.includes(tool) ? cur.filter((s) => s !== tool) : [...cur, tool]));
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch('/api/dev/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          scopes,
          mcpTools,
          expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
        }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not mint token.');
        return;
      }
      const result = (await r.json()) as MintResult;
      onMinted(result);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg space-y-4 rounded-lg bg-background p-6"
      >
        <h2 id={titleId} className="font-medium text-lg">
          Mint a new token
        </h2>
        <div>
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="CI bot, my-laptop, Cursor, ..."
          />
        </div>
        <div className="space-y-2">
          <Label>Preset</Label>
          <div className="flex flex-wrap gap-2">
            {Object.keys(PRESETS).map((p) => (
              <Button
                key={p}
                size="sm"
                variant="outline"
                onClick={() => applyPreset(p as keyof typeof PRESETS)}
              >
                {p}
              </Button>
            ))}
          </div>
        </div>
        <details className="rounded border p-2">
          <summary className="cursor-pointer text-sm">Custom scopes ({scopes.length})</summary>
          <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
            {ALL_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={() => toggleScope(s)}
                />
                {s}
              </label>
            ))}
          </div>
        </details>
        {showMcpTools && (
          <details className="rounded border p-2" open>
            <summary className="cursor-pointer text-sm">
              MCP-tool allowlist ({mcpTools.length})
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
              {MCP_TOOL_IDS.map((t) => (
                <label key={t} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={mcpTools.includes(t)}
                    onChange={() => toggleTool(t)}
                  />
                  {t}
                </label>
              ))}
            </div>
          </details>
        )}
        <div>
          <Label htmlFor={expiryId}>Expires in (days)</Label>
          <Input
            id={expiryId}
            type="number"
            min={1}
            max={365}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
          />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name || scopes.length === 0}>
            Mint
          </Button>
        </div>
      </div>
    </div>
  );
}

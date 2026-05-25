'use client';

import { Fragment, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type MintResult, MintTokenDialog } from './mint-token-dialog';
import { TokenUsageTimeline } from './token-usage-timeline';

export type DevTokenRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  mcpTools: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

export function TokenList({ initialTokens }: { initialTokens: DevTokenRow[] }) {
  const [tokens, setTokens] = useState<DevTokenRow[]>(initialTokens);
  const [minting, setMinting] = useState(false);
  const [revealed, setRevealed] = useState<MintResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string) {
    setError(null);
    const r = await fetch(`/api/dev/tokens/${id}`, { method: 'DELETE' });
    if (!r.ok) {
      setError('Could not revoke that token.');
      return;
    }
    setTokens((cur) => cur.filter((t) => t.id !== id));
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Personal access tokens</CardTitle>
        <Button
          onClick={() => setMinting(true)}
          // WCAG 2.5.5: enforce a 44px-tall touch target on the page CTA.
          className="min-h-11"
        >
          Mint new token
        </Button>
      </CardHeader>
      <CardContent>
        {tokens.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No active tokens. Mint one to call the Cairn API or connect an MCP client.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2">Name</th>
                <th>Prefix</th>
                <th>Scopes</th>
                <th>Last used</th>
                <th>Expires</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <Fragment key={t.id}>
                  <tr className="border-t">
                    <td className="py-2">{t.name}</td>
                    <td className="font-mono text-xs">{t.tokenPrefix}…</td>
                    <td className="text-xs">{t.scopes.join(', ')}</td>
                    <td>{fmtDate(t.lastUsedAt)}</td>
                    <td>{fmtDate(t.expiresAt)}</td>
                    <td className="space-x-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setExpanded((e) => (e === t.id ? null : t.id))}
                      >
                        {expanded === t.id ? 'Hide usage' : 'Show usage'}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => void revoke(t.id)}>
                        Revoke
                      </Button>
                    </td>
                  </tr>
                  {expanded === t.id && (
                    <tr>
                      <td colSpan={6} className="p-3">
                        <TokenUsageTimeline tokenId={t.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        {error && <p className="mt-2 text-destructive text-sm">{error}</p>}

        {minting && (
          <MintTokenDialog
            onClose={() => setMinting(false)}
            onMinted={(result) => {
              setMinting(false);
              setRevealed(result);
              setTokens((cur) => [
                {
                  id: result.row.id,
                  name: result.row.name,
                  tokenPrefix: result.row.tokenPrefix,
                  scopes: result.row.scopes,
                  mcpTools: result.row.mcpTools,
                  lastUsedAt: null,
                  expiresAt: result.row.expiresAt,
                  createdAt: result.row.createdAt,
                },
                ...cur,
              ]);
            }}
          />
        )}

        {revealed && (
          <div className="mt-4 rounded-md border border-dashed p-3">
            <p className="font-medium text-sm">Save this token now — it will not be shown again.</p>
            <code className="mt-2 block break-all rounded bg-muted p-2 font-mono text-xs">
              {revealed.token}
            </code>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(revealed.token);
                }}
              >
                Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRevealed(null)}>
                I&apos;ve saved it
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

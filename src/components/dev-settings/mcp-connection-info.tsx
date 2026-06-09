'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/lib/i18n/provider';

export function McpConnectionInfo({ publicUrl }: { publicUrl: string }) {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  const mcpUrl = `${publicUrl}/api/mcp`;

  const claudeDesktop = JSON.stringify(
    {
      mcpServers: {
        cairn: {
          transport: 'streamable-http',
          url: mcpUrl,
          headers: { Authorization: 'Bearer <paste-your-cairn_pat_-token>' },
        },
      },
    },
    null,
    2,
  );

  const cursor = JSON.stringify(
    {
      mcpServers: {
        cairn: {
          url: mcpUrl,
          headers: { Authorization: 'Bearer <paste-your-cairn_pat_-token>' },
        },
      },
    },
    null,
    2,
  );

  function copy(label: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>MCP connection info</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* v0.9.16 Plan F — lead with OAuth: the client opens a browser to
            approve access; no token to paste. */}
        <div>
          <p className="font-medium text-sm">{t('mcpConn.oauthTitle')}</p>
          <p className="text-muted-foreground text-sm">{t('mcpConn.oauthBody')}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <code className="block flex-1 break-all rounded bg-muted p-2 font-mono text-xs">
              {mcpUrl}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copy('url', mcpUrl)}
              className="min-h-11 min-w-11 shrink-0"
            >
              {copied === 'url' ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>

        <details className="rounded border p-2">
          <summary className="cursor-pointer text-sm">{t('mcpConn.bearerToggle')}</summary>
          <div className="mt-3 space-y-4">
            <p className="text-muted-foreground text-xs">{t('mcpConn.bearerBody')}</p>
            <div>
              <div className="flex items-center justify-between">
                <p id="mcp-claude-label" className="text-sm">
                  Claude Desktop config
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copy('claude', claudeDesktop)}
                  // WCAG 2.5.5: enforce ≥44×44 touch target on inline Copy.
                  className="min-h-11 min-w-11"
                >
                  {copied === 'claude' ? 'Copied' : 'Copy'}
                </Button>
              </div>
              {/* axe `scrollable-region-focusable` requires the overflow <pre> to
                  be keyboard-reachable; `tabIndex={0}` + a labelled `role=region`
                  satisfies that. Biome's noNoninteractiveTabindex /
                  useSemanticElements are intentionally suppressed below. */}
              {/* biome-ignore-start lint/a11y/useSemanticElements: scrollable region role is correct for the overflow surface; <pre> is the visual container. */}
              {/* biome-ignore-start lint/a11y/noNoninteractiveTabindex: scrollable overflow region — keyboard-reachable per axe scrollable-region-focusable. */}
              <pre
                tabIndex={0}
                role="region"
                aria-labelledby="mcp-claude-label"
                className="overflow-x-auto rounded bg-muted p-2 text-xs"
              >
                {claudeDesktop}
              </pre>
              {/* biome-ignore-end lint/a11y/noNoninteractiveTabindex: end. */}
              {/* biome-ignore-end lint/a11y/useSemanticElements: end. */}
            </div>
            <div>
              <div className="flex items-center justify-between">
                <p id="mcp-cursor-label" className="text-sm">
                  Cursor config
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copy('cursor', cursor)}
                  // WCAG 2.5.5: enforce ≥44×44 touch target on inline Copy.
                  className="min-h-11 min-w-11"
                >
                  {copied === 'cursor' ? 'Copied' : 'Copy'}
                </Button>
              </div>
              {/* biome-ignore-start lint/a11y/useSemanticElements: scrollable region role is correct for the overflow surface; <pre> is the visual container. */}
              {/* biome-ignore-start lint/a11y/noNoninteractiveTabindex: scrollable overflow region — keyboard-reachable per axe scrollable-region-focusable. */}
              <pre
                tabIndex={0}
                role="region"
                aria-labelledby="mcp-cursor-label"
                className="overflow-x-auto rounded bg-muted p-2 text-xs"
              >
                {cursor}
              </pre>
              {/* biome-ignore-end lint/a11y/noNoninteractiveTabindex: end. */}
              {/* biome-ignore-end lint/a11y/useSemanticElements: end. */}
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

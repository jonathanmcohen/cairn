'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function McpConnectionInfo({ publicUrl }: { publicUrl: string }) {
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
        <div>
          <p className="text-sm">Server URL</p>
          <code className="block break-all rounded bg-muted p-2 font-mono text-xs">{mcpUrl}</code>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm">Claude Desktop config</p>
            <Button size="sm" variant="outline" onClick={() => copy('claude', claudeDesktop)}>
              {copied === 'claude' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{claudeDesktop}</pre>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm">Cursor config</p>
            <Button size="sm" variant="outline" onClick={() => copy('cursor', cursor)}>
              {copied === 'cursor' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{cursor}</pre>
        </div>
      </CardContent>
    </Card>
  );
}

'use client';

import { useState } from 'react';

export type EditorProps = {
  pageId: string;
  initialContent: unknown;
  initialUpdatedAt: string;
};

export function Editor({ initialContent }: EditorProps) {
  const [content] = useState(initialContent);
  return (
    <div className="prose dark:prose-invert max-w-none">
      <p className="text-muted-foreground text-sm">
        TipTap editor is wired in Task 18+. Placeholder for now.
      </p>
      <pre className="bg-muted overflow-auto rounded p-3 text-xs">
        {JSON.stringify(content, null, 2)}
      </pre>
    </div>
  );
}

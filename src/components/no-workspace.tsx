'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { usePrompt } from '@/components/ui/input-dialog';

export function NoWorkspace() {
  const router = useRouter();
  const prompt = usePrompt();
  const [busy, setBusy] = useState(false);

  async function create() {
    const name = await prompt({
      title: 'Name your first workspace',
      label: 'Workspace name',
      placeholder: 'e.g. Acme HQ',
      confirmLabel: 'Create',
    });
    if (!name?.trim()) return;
    setBusy(true);
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
      router.push('/');
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">You&apos;re not in any workspace yet</h1>
      <p className="text-muted-foreground">
        Create a workspace to get started, or ask a teammate to send you an invite.
      </p>
      <Button onClick={() => void create()} disabled={busy}>
        {busy ? 'Creating…' : 'Create a workspace'}
      </Button>
    </div>
  );
}

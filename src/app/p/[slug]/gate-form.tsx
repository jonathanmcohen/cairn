'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function GateForm({ slug }: { slug: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(fd: FormData) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/p/${slug}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: String(fd.get('password') ?? '') }),
    });
    if (res.ok) {
      window.location.reload();
      return;
    }
    setError('Incorrect password');
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-24">
      <h1 className="mb-4 text-xl font-semibold">This page is protected</h1>
      <form action={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required autoComplete="off" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Checking…' : 'Unlock'}
        </Button>
      </form>
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/**
 * Reset-quota row action. Clicking calls
 * `POST /api/admin/pats/[tokenId]/reset-quota`, then `router.refresh()` so
 * the RSC parent re-fetches the rollup counters. Toast surfaces success/error
 * — never echoes back the limit/usage values (info leak).
 *
 * v0.9.0 G1 P10.
 */
export function PatRow({ tokenId, name }: { tokenId: string; name: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onReset(): Promise<void> {
    setPending(true);
    try {
      const res = await fetch(`/api/admin/pats/${tokenId}/reset-quota`, { method: 'POST' });
      if (!res.ok) throw new Error(`reset failed: ${res.status}`);
      toast.success('Quota reset', {
        description: `Cleared usage counters for ${name}.`,
      });
      router.refresh();
    } catch (err) {
      toast.error('Reset failed', {
        description: err instanceof Error ? err.message : 'unknown',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={onReset} disabled={pending}>
      {pending ? 'Resetting…' : 'Reset quota'}
    </Button>
  );
}

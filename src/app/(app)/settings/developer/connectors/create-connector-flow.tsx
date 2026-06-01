'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/provider';

type DatabaseOption = { id: string; name: string };
type Kind = 'google_sheets' | 'airtable' | 'csv';

export function CreateConnectorFlow({ databases }: { databases: DatabaseOption[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [databaseId, setDatabaseId] = useState(databases[0]?.id ?? '');
  const [kind, setKind] = useState<Kind>('google_sheets');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ databaseId, kind }),
      });
      if (!res.ok) {
        setError(t('connectorsDb.create.error'));
        return;
      }
      const body = (await res.json()) as { id: string };
      router.push(`/settings/developer/connectors/${body.id}`);
    } catch {
      setError(t('connectorsDb.create.error'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button className="min-h-11" onClick={() => setOpen(true)}>
        {t('connectorsDb.create')}
      </Button>
    );
  }

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="space-y-1">
        <Label htmlFor="connector-database">{t('connectorsDb.create.chooseDatabase')}</Label>
        <Select value={databaseId} onValueChange={setDatabaseId}>
          <SelectTrigger
            id="connector-database"
            className="w-full"
            aria-label={t('connectorsDb.create.chooseDatabase')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {databases.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="connector-kind">{t('connectorsDb.create.chooseKind')}</Label>
        <Select value={kind} onValueChange={(next) => setKind(next as Kind)}>
          <SelectTrigger
            id="connector-kind"
            className="w-full"
            aria-label={t('connectorsDb.create.chooseKind')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="google_sheets">
              {t('connectorsDb.create.kind.google_sheets')}
            </SelectItem>
            <SelectItem value="airtable">{t('connectorsDb.create.kind.airtable')}</SelectItem>
            <SelectItem value="csv">{t('connectorsDb.create.kind.csv')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button className="min-h-11" disabled={busy || !databaseId} onClick={onCreate}>
          {t('connectorsDb.create.submit')}
        </Button>
        <Button
          variant="ghost"
          className="min-h-11"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          {t('connectorsDb.create.cancel')}
        </Button>
      </div>
    </div>
  );
}

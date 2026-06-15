'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/provider';

type Provider = 's3' | 'r2' | 'minio' | 'b2';
type Consumer = 'uploads' | 'backups' | 'siem';

export type StorageConfigInitial = {
  configured: boolean;
  source: 'db' | 'env' | 'none';
  provider: Provider;
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  pathPrefix: string;
  publicBucket: boolean;
  secretKeySet: boolean;
  uploadsEnabled: boolean;
  backupsEnabled: boolean;
  siemEnabled: boolean;
};

const PROVIDER_OPTIONS: Provider[] = ['s3', 'r2', 'minio', 'b2'];
const CONSUMERS: Consumer[] = ['uploads', 'backups', 'siem'];

export function StorageConfigForm({ initial }: { initial: StorageConfigInitial }) {
  const t = useT();
  const ids = {
    provider: useId(),
    endpoint: useId(),
    region: useId(),
    bucket: useId(),
    accessKey: useId(),
    secretKey: useId(),
    pathPrefix: useId(),
    publicBucket: useId(),
    uploads: useId(),
    backups: useId(),
    siem: useId(),
  };

  const [provider, setProvider] = useState<Provider>(initial.provider);
  const [endpoint, setEndpoint] = useState(initial.endpoint);
  const [region, setRegion] = useState(initial.region);
  const [bucket, setBucket] = useState(initial.bucket);
  const [accessKey, setAccessKey] = useState(initial.accessKey);
  const [secretKey, setSecretKey] = useState('');
  const [pathPrefix, setPathPrefix] = useState(initial.pathPrefix);
  const [publicBucket, setPublicBucket] = useState(initial.publicBucket);
  const [uploadsEnabled, setUploadsEnabled] = useState(initial.uploadsEnabled);
  const [backupsEnabled, setBackupsEnabled] = useState(initial.backupsEnabled);
  const [siemEnabled, setSiemEnabled] = useState(initial.siemEnabled);
  const [secretKeySet, setSecretKeySet] = useState(initial.secretKeySet);
  const [source, setSource] = useState(initial.source);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Consumer opt-ins are gated server-side on a stored config + secret key.
  // Disable the toggles in the UI until a secret has been saved (or the admin
  // is about to set one this save) so the gate isn't a surprise.
  const optInUnlocked = secretKeySet || secretKey.length > 0;

  const consumerState: Record<Consumer, [boolean, (v: boolean) => void]> = {
    uploads: [uploadsEnabled, setUploadsEnabled],
    backups: [backupsEnabled, setBackupsEnabled],
    siem: [siemEnabled, setSiemEnabled],
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const body: Record<string, unknown> = {
        provider,
        endpoint,
        region,
        bucket,
        accessKey: accessKey || null,
        pathPrefix: pathPrefix || null,
        publicBucket,
        uploadsEnabled,
        backupsEnabled,
        siemEnabled,
      };
      // Write-once: only send the secret key when the admin typed a new one.
      if (secretKey) body.secretKey = secretKey;
      const res = await fetch('/api/admin/object-storage-config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await errText(res));
      const data = (await res.json()) as StorageConfigInitial;
      setSecretKeySet(data.secretKeySet);
      setSource(data.source);
      setSecretKey('');
      setUploadsEnabled(data.uploadsEnabled);
      setBackupsEnabled(data.backupsEnabled);
      setSiemEnabled(data.siemEnabled);
      setStatus({ kind: 'ok', text: t('storageConfig.saved') });
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setStatus(null);
    try {
      const res = await fetch('/api/admin/object-storage-config/test', { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setStatus({ kind: 'ok', text: t('storageConfig.testOk') });
      } else {
        setStatus({
          kind: 'error',
          text: `${t('storageConfig.testFailed')}: ${data.error ?? ''}`,
        });
      }
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'error' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('storageConfig.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {source === 'env' ? (
          <p
            data-testid="storage-config-source-env"
            className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-sm"
          >
            {t('storageConfig.sourceEnv')}
          </p>
        ) : null}
        <form data-testid="storage-config-form" onSubmit={save} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor={ids.provider}>{t('storageConfig.provider')}</Label>
            <Select value={provider} onValueChange={(next) => setProvider(next as Provider)}>
              <SelectTrigger id={ids.provider} data-testid="storage-config-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(`storageConfig.providers.${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={ids.endpoint}>{t('storageConfig.endpoint')}</Label>
            <Input
              id={ids.endpoint}
              data-testid="storage-config-endpoint"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor={ids.region}>{t('storageConfig.region')}</Label>
              <Input
                id={ids.region}
                data-testid="storage-config-region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={ids.bucket}>{t('storageConfig.bucket')}</Label>
              <Input
                id={ids.bucket}
                data-testid="storage-config-bucket"
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={ids.accessKey}>{t('storageConfig.accessKey')}</Label>
            <Input
              id={ids.accessKey}
              data-testid="storage-config-access-key"
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={ids.secretKey}>{t('storageConfig.secretKey')}</Label>
            <Input
              id={ids.secretKey}
              data-testid="storage-config-secret-key"
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder={secretKeySet ? t('storageConfig.secretKeySet') : ''}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={ids.pathPrefix}>{t('storageConfig.pathPrefix')}</Label>
            <Input
              id={ids.pathPrefix}
              data-testid="storage-config-path-prefix"
              value={pathPrefix}
              onChange={(e) => setPathPrefix(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id={ids.publicBucket}
              data-testid="storage-config-public-bucket"
              type="checkbox"
              checked={publicBucket}
              onChange={(e) => setPublicBucket(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor={ids.publicBucket}>{t('storageConfig.publicBucket')}</Label>
          </div>

          <fieldset className="space-y-2 rounded-md border border-border p-3">
            <legend className="px-1 font-medium text-sm">{t('storageConfig.consumers')}</legend>
            {!optInUnlocked ? (
              <p data-testid="storage-config-optin-hint" className="text-muted-foreground text-xs">
                {t('storageConfig.consumersHint')}
              </p>
            ) : null}
            {CONSUMERS.map((c) => {
              const [value, setValue] = consumerState[c];
              return (
                <div key={c} className="flex items-center gap-2">
                  <input
                    id={ids[c]}
                    data-testid={`storage-config-consumer-${c}`}
                    type="checkbox"
                    checked={value}
                    disabled={!optInUnlocked}
                    onChange={(e) => setValue(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor={ids[c]}>{t(`storageConfig.consumer.${c}`)}</Label>
                </div>
              );
            })}
          </fieldset>

          {status ? (
            <p
              role="status"
              data-testid="storage-config-status"
              className={
                status.kind === 'ok' ? 'text-sm text-green-600' : 'text-sm text-destructive'
              }
            >
              {status.text}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" data-testid="storage-config-save" disabled={saving}>
              {saving ? t('storageConfig.saving') : t('storageConfig.save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="storage-config-test"
              onClick={runTest}
              disabled={testing || !endpoint || !bucket}
            >
              {testing ? t('storageConfig.testing') : t('storageConfig.test')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

async function errText(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

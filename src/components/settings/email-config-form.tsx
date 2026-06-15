'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n/provider';

type TlsMode = 'starttls' | 'tls' | 'none';

export type EmailConfigInitial = {
  configured: boolean;
  source: 'db' | 'env' | 'none';
  host: string;
  port: number;
  tlsMode: TlsMode;
  username: string;
  fromAddress: string;
  replyTo: string;
  passwordSet: boolean;
};

const TLS_OPTIONS: TlsMode[] = ['starttls', 'tls', 'none'];

export function EmailConfigForm({ initial }: { initial: EmailConfigInitial }) {
  const t = useT();
  const ids = {
    host: useId(),
    port: useId(),
    tls: useId(),
    user: useId(),
    pass: useId(),
    from: useId(),
    reply: useId(),
  };

  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(String(initial.port));
  const [tlsMode, setTlsMode] = useState<TlsMode>(initial.tlsMode);
  const [username, setUsername] = useState(initial.username);
  const [password, setPassword] = useState('');
  const [fromAddress, setFromAddress] = useState(initial.fromAddress);
  const [replyTo, setReplyTo] = useState(initial.replyTo);
  const [passwordSet, setPasswordSet] = useState(initial.passwordSet);
  const [source, setSource] = useState(initial.source);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const body: Record<string, unknown> = {
        host,
        port: Number(port),
        tlsMode,
        username: username || null,
        fromAddress,
        replyTo: replyTo || null,
      };
      // Write-once: only send the password when the admin typed a new one.
      if (password) body.password = password;
      const res = await fetch('/api/admin/email-config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await errText(res));
      const data = (await res.json()) as EmailConfigInitial;
      setPasswordSet(data.passwordSet);
      setSource(data.source);
      setPassword('');
      setStatus({ kind: 'ok', text: t('emailConfig.saved') });
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setStatus(null);
    try {
      const res = await fetch('/api/admin/email-config/test', { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setStatus({ kind: 'ok', text: t('emailConfig.testSent') });
      } else {
        setStatus({ kind: 'error', text: `${t('emailConfig.testFailed')}: ${data.error ?? ''}` });
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
        <CardTitle>{t('emailConfig.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {source === 'env' ? (
          <p
            data-testid="email-config-source-env"
            className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-sm"
          >
            {t('emailConfig.sourceEnv')}
          </p>
        ) : null}
        <form data-testid="email-config-form" onSubmit={save} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor={ids.host}>{t('emailConfig.host')}</Label>
            <Input
              id={ids.host}
              data-testid="email-config-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor={ids.port}>{t('emailConfig.port')}</Label>
              <Input
                id={ids.port}
                data-testid="email-config-port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={ids.tls}>{t('emailConfig.tlsMode')}</Label>
              <select
                id={ids.tls}
                data-testid="email-config-tls"
                value={tlsMode}
                onChange={(e) => setTlsMode(e.target.value as TlsMode)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {TLS_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {t(`emailConfig.tls.${m}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={ids.user}>{t('emailConfig.username')}</Label>
            <Input
              id={ids.user}
              data-testid="email-config-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={ids.pass}>{t('emailConfig.password')}</Label>
            <Input
              id={ids.pass}
              data-testid="email-config-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={passwordSet ? t('emailConfig.passwordSet') : ''}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={ids.from}>{t('emailConfig.fromAddress')}</Label>
            <Input
              id={ids.from}
              data-testid="email-config-from"
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={ids.reply}>{t('emailConfig.replyTo')}</Label>
            <Input
              id={ids.reply}
              data-testid="email-config-replyto"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
            />
          </div>
          {status ? (
            <p
              role="status"
              data-testid="email-config-status"
              className={
                status.kind === 'ok' ? 'text-sm text-green-600' : 'text-sm text-destructive'
              }
            >
              {status.text}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" data-testid="email-config-save" disabled={saving}>
              {saving ? t('emailConfig.saving') : t('emailConfig.save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="email-config-test"
              onClick={sendTest}
              disabled={testing || !host}
            >
              {testing ? t('emailConfig.testSending') : t('emailConfig.testSend')}
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

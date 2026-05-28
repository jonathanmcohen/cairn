'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type OidcFormValues = {
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  emailClaim: string;
  nameClaim: string;
  enabled: boolean;
};

const DEFAULTS: OidcFormValues = {
  name: '',
  issuer: '',
  clientId: '',
  clientSecret: '',
  emailClaim: 'email',
  nameClaim: 'name',
  enabled: false,
};

export function OidcForm(props: { initial?: Partial<OidcFormValues>; idpId?: string }) {
  const router = useRouter();
  const [v, setV] = useState<OidcFormValues>({ ...DEFAULTS, ...(props.initial ?? {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const metadata: Record<string, string> = {
        issuer: v.issuer,
        clientId: v.clientId,
      };
      // Only send clientSecret if non-empty (edit form leaves it blank to keep prior).
      if (v.clientSecret) metadata.clientSecret = v.clientSecret;
      const body = {
        name: v.name,
        metadata,
        attributeMap: { email: v.emailClaim, name: v.nameClaim },
        enabled: v.enabled,
      };
      const res = await fetch(
        props.idpId ? `/api/admin/sso/oidc/${props.idpId}` : '/api/admin/sso/oidc',
        {
          method: props.idpId ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      router.push('/admin/sso');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-xl">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor="oidc-name">Display name</Label>
        <Input
          id="oidc-name"
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="oidc-issuer">Issuer URL</Label>
        <Input
          id="oidc-issuer"
          type="url"
          value={v.issuer}
          onChange={(e) => setV({ ...v, issuer: e.target.value })}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="oidc-client-id">Client ID</Label>
        <Input
          id="oidc-client-id"
          value={v.clientId}
          onChange={(e) => setV({ ...v, clientId: e.target.value })}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="oidc-client-secret">Client secret</Label>
        <Input
          id="oidc-client-secret"
          type="password"
          value={v.clientSecret}
          onChange={(e) => setV({ ...v, clientSecret: e.target.value })}
          required={!props.idpId}
          placeholder={props.idpId ? '(leave blank to keep existing)' : ''}
        />
      </div>
      <div className="flex gap-4">
        <div className="space-y-1 flex-1">
          <Label htmlFor="oidc-email-claim">Email claim</Label>
          <Input
            id="oidc-email-claim"
            value={v.emailClaim}
            onChange={(e) => setV({ ...v, emailClaim: e.target.value })}
          />
        </div>
        <div className="space-y-1 flex-1">
          <Label htmlFor="oidc-name-claim">Name claim</Label>
          <Input
            id="oidc-name-claim"
            value={v.nameClaim}
            onChange={(e) => setV({ ...v, nameClaim: e.target.value })}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.enabled}
          onChange={(e) => setV({ ...v, enabled: e.target.checked })}
        />
        Enabled
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving...' : props.idpId ? 'Save changes' : 'Create'}
      </Button>
    </form>
  );
}

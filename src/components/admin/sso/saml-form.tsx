'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type SamlFormValues = {
  name: string;
  idpEntityId: string;
  ssoUrl: string;
  x509Cert: string;
  emailAttr: string;
  nameAttr: string;
  enabled: boolean;
};

const DEFAULTS: SamlFormValues = {
  name: '',
  idpEntityId: '',
  ssoUrl: '',
  x509Cert: '',
  emailAttr: 'email',
  nameAttr: 'name',
  enabled: false,
};

export function SamlForm(props: {
  initial?: Partial<SamlFormValues>;
  idpId?: string;
  metadataUrl?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<SamlFormValues>({ ...DEFAULTS, ...(props.initial ?? {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: v.name,
        idp: { entityId: v.idpEntityId, ssoUrl: v.ssoUrl, x509Cert: v.x509Cert },
        attributeMap: { email: v.emailAttr, name: v.nameAttr },
        enabled: v.enabled,
      };
      const res = await fetch(
        props.idpId ? `/api/admin/sso/saml/${props.idpId}` : '/api/admin/sso/saml',
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
      {props.metadataUrl ? (
        <div className="rounded border bg-muted/30 p-3 text-sm">
          <p className="mb-1 font-medium">Cairn SP metadata XML</p>
          <p className="break-all">
            <a
              className="underline"
              href={props.metadataUrl}
              download={`cairn-sp-${props.idpId}.xml`}
            >
              {props.metadataUrl}
            </a>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload this URL (or its content) into your IdP&apos;s &ldquo;service provider
            metadata&rdquo; field.
          </p>
        </div>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor="saml-name">Display name</Label>
        <Input
          id="saml-name"
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="saml-entity">IdP entity ID</Label>
        <Input
          id="saml-entity"
          value={v.idpEntityId}
          onChange={(e) => setV({ ...v, idpEntityId: e.target.value })}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="saml-sso-url">IdP SSO URL</Label>
        <Input
          id="saml-sso-url"
          type="url"
          value={v.ssoUrl}
          onChange={(e) => setV({ ...v, ssoUrl: e.target.value })}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="saml-cert">IdP X.509 certificate (PEM body, base64)</Label>
        <textarea
          id="saml-cert"
          className="w-full rounded border p-2 font-mono text-xs"
          rows={6}
          value={v.x509Cert}
          onChange={(e) => setV({ ...v, x509Cert: e.target.value })}
          required={!props.idpId}
          placeholder={props.idpId ? '(leave blank to keep existing)' : 'MIIDX...'}
        />
      </div>
      <div className="flex gap-4">
        <div className="space-y-1 flex-1">
          <Label htmlFor="saml-email-attr">Email attribute name</Label>
          <Input
            id="saml-email-attr"
            value={v.emailAttr}
            onChange={(e) => setV({ ...v, emailAttr: e.target.value })}
          />
        </div>
        <div className="space-y-1 flex-1">
          <Label htmlFor="saml-name-attr">Display-name attribute</Label>
          <Input
            id="saml-name-attr"
            value={v.nameAttr}
            onChange={(e) => setV({ ...v, nameAttr: e.target.value })}
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
        {busy ? 'Saving…' : props.idpId ? 'Save changes' : 'Create'}
      </Button>
    </form>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/components/ui/status-banner';
import { useT } from '@/lib/i18n/provider';
import { clampAccessiblePrimary, normalizeHexColor } from '@/lib/workspaces/brand-color';

export type BrandInitial = {
  logoFileId: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
};

const DEFAULT_PICKER_HEX = '#2563eb';

/**
 * v0.10.0 F1 — "Brand" card on Workspace settings → General (page is
 * admin-gated; the GET API stays member-readable). Logo goes through the
 * existing /api/upload flow, then the returned fileId is PATCHed to the brand
 * route. The color pairs a native `<input type="color">` with a hex text
 * field; when the pick would be clamped for contrast, a live "adjusted for
 * readability" note shows before saving.
 */
export function BrandSettings({
  workspaceId,
  initial,
}: {
  workspaceId: string;
  initial: BrandInitial;
}) {
  const t = useT();
  const router = useRouter();
  const colorId = useId();
  const hexId = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [logoFileId, setLogoFileId] = useState<string | null>(initial.logoFileId);
  const [logoUrl, setLogoUrl] = useState<string | null>(initial.logoUrl);
  // hexText mirrors what the user typed; colorEnabled=false means "no brand
  // color" (null on save).
  const [colorEnabled, setColorEnabled] = useState(initial.primaryColor !== null);
  const [hexText, setHexText] = useState(initial.primaryColor ?? DEFAULT_PICKER_HEX);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const normalizedHex = useMemo(() => normalizeHexColor(hexText), [hexText]);
  const clampInfo = useMemo(
    () => (colorEnabled && normalizedHex ? clampAccessiblePrimary(normalizedHex) : null),
    [colorEnabled, normalizedHex],
  );

  async function uploadLogo(file: File) {
    setError(null);
    setSaved(false);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? t('workspaceSettings.brand.uploadError'));
        return;
      }
      const body = (await res.json()) as { file: { id: string }; signedUrl: string };
      setLogoFileId(body.file.id);
      setLogoUrl(body.signedUrl);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function save() {
    setError(null);
    setSaved(false);
    if (colorEnabled && !normalizedHex) {
      setError(t('workspaceSettings.brand.invalidHex'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/brand`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          logoFileId,
          primaryColor: colorEnabled ? normalizedHex : null,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? `Failed to save (${res.status})`);
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      data-testid="brand-settings-card"
      className="mt-8 flex max-w-lg flex-col gap-4 rounded-lg border p-4"
    >
      <div>
        <h2 className="text-base font-semibold">{t('workspaceSettings.brand.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('workspaceSettings.brand.description')}</p>
      </div>

      {error ? <StatusBanner variant="error">{error}</StatusBanner> : null}
      {saved ? (
        <StatusBanner variant="success">{t('workspaceSettings.brand.saved')}</StatusBanner>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t('workspaceSettings.brand.logoLabel')}</span>
        {logoUrl ? (
          // biome-ignore lint/performance/noImgElement: HMAC-signed expiring URL — bypasses next/image loader
          <img
            data-testid="brand-logo-preview"
            src={logoUrl}
            alt={t('workspaceSettings.brand.logoAlt')}
            className="max-h-14 w-auto max-w-[60%] self-start rounded border object-contain p-1"
          />
        ) : null}
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadLogo(f);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="brand-logo-upload"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? '…' : t('workspaceSettings.brand.uploadLogo')}
          </Button>
          {logoFileId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="brand-logo-remove"
              onClick={() => {
                setLogoFileId(null);
                setLogoUrl(null);
              }}
            >
              {t('workspaceSettings.brand.removeLogo')}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t('workspaceSettings.brand.logoHint')}</p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={colorId} className="text-sm font-medium">
          {t('workspaceSettings.brand.colorLabel')}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={colorId}
            type="color"
            data-testid="brand-color-picker"
            value={normalizedHex ?? DEFAULT_PICKER_HEX}
            onChange={(e) => {
              setColorEnabled(true);
              setHexText(e.target.value);
            }}
            className="h-9 w-12 cursor-pointer rounded border bg-transparent p-1"
            aria-label={t('workspaceSettings.brand.colorLabel')}
          />
          <input
            id={hexId}
            type="text"
            data-testid="brand-color-hex"
            value={colorEnabled ? hexText : ''}
            placeholder="#2563eb"
            maxLength={7}
            onChange={(e) => {
              setColorEnabled(e.target.value.trim().length > 0);
              setHexText(e.target.value);
            }}
            aria-label={t('workspaceSettings.brand.hexLabel')}
            className="w-28 rounded border px-2 py-1 font-mono text-sm"
          />
          {colorEnabled ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="brand-color-clear"
              onClick={() => setColorEnabled(false)}
            >
              {t('workspaceSettings.brand.clearColor')}
            </Button>
          ) : null}
        </div>
        {colorEnabled && hexText.trim().length > 0 && !normalizedHex ? (
          <p className="text-xs text-destructive">{t('workspaceSettings.brand.invalidHex')}</p>
        ) : null}
        {clampInfo?.clamped ? (
          <p data-testid="brand-contrast-note" className="text-xs text-warning">
            {t('workspaceSettings.brand.contrastAdjusted')}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t('workspaceSettings.brand.colorHint')}</p>
      </div>

      <div>
        <Button
          type="button"
          data-testid="brand-save"
          disabled={submitting || uploading}
          onClick={() => void save()}
        >
          {submitting ? '…' : t('workspaceSettings.brand.save')}
        </Button>
      </div>
    </section>
  );
}

import { env } from '@/lib/env';
import { signFileUrl } from '@/lib/files/signing';
import { parseIcon } from '@/lib/pages/icon-format';

/** 1-hour TTL matches the editor image links + cover banner. */
const UPLOAD_TTL_SECONDS = 60 * 60;

export type PageIconRenderProps = {
  value: string | null;
  /** Fallback shown when value is null (also when value is `''`). */
  fallback?: string;
  /** Pixel size for both emoji + image. Defaults to 24. */
  size?: number;
};

export function PageIconRender({ value, fallback = '📄', size = 24 }: PageIconRenderProps) {
  const parsed = parseIcon(value);
  if (!parsed) {
    return (
      <span aria-hidden="true" style={{ fontSize: size }}>
        {fallback}
      </span>
    );
  }
  if (parsed.kind === 'emoji') {
    return (
      <span aria-hidden="true" style={{ fontSize: size }}>
        {parsed.value}
      </span>
    );
  }
  const expiresAt = Math.floor(Date.now() / 1000) + UPLOAD_TTL_SECONDS;
  const sig = signFileUrl({ fileId: parsed.value, expiresAt, secret: env().AUTH_SECRET });
  const src = `/api/files/${parsed.value}?sig=${sig}&exp=${expiresAt}`;
  return (
    // biome-ignore lint/performance/noImgElement: signed URL — bypasses next/image loader
    <img src={src} alt="" width={size} height={size} className="inline-block rounded-sm" />
  );
}

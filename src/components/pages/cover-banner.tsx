import { env } from '@/lib/env';
import { signFileUrl } from '@/lib/files/signing';
import type { PageCover } from '@/lib/pages/cover';
import { getCoverPreset } from '@/lib/pages/cover-presets';

/** 1-hour TTL matches the editor image links + the public-page resign helper. */
const UPLOAD_TTL_SECONDS = 60 * 60;

export type CoverBannerProps = {
  cover: PageCover;
  /** Used as the `<img>` alt for upload/unsplash covers. */
  alt?: string;
};

/**
 * Server-rendered cover banner (200px). Renders nothing when cover is `{}`.
 *
 * Upload covers go through the existing HMAC-signed `/api/files/<id>` URL —
 * never a raw path — so the same access controls apply on view.
 */
export function CoverBanner({ cover, alt = '' }: CoverBannerProps) {
  if (!('kind' in cover)) return null;

  if (cover.kind === 'preset') {
    const preset = getCoverPreset(cover.value);
    if (!preset) return null;
    return (
      <div
        aria-hidden="true"
        data-cairn-cover=""
        className="cairn-cover h-[200px] w-full"
        style={
          preset.type === 'gradient'
            ? { backgroundImage: preset.css }
            : { backgroundColor: preset.css }
        }
      />
    );
  }

  if (cover.kind === 'color') {
    return (
      <div
        aria-hidden="true"
        data-cairn-cover=""
        className="cairn-cover h-[200px] w-full"
        style={{ backgroundColor: cover.value }}
      />
    );
  }

  if (cover.kind === 'unsplash') {
    return (
      <div data-cairn-cover="" className="cairn-cover h-[200px] w-full overflow-hidden">
        {/** biome-ignore lint/performance/noImgElement: external host, no next/image config */}
        <img src={cover.value} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      </div>
    );
  }

  if (cover.kind === 'upload') {
    const expiresAt = Math.floor(Date.now() / 1000) + UPLOAD_TTL_SECONDS;
    const sig = signFileUrl({ fileId: cover.value, expiresAt, secret: env().AUTH_SECRET });
    const src = `/api/files/${cover.value}?sig=${sig}&exp=${expiresAt}`;
    return (
      <div data-cairn-cover="" className="cairn-cover h-[200px] w-full overflow-hidden">
        {/** biome-ignore lint/performance/noImgElement: signed URL — bypasses next/image loader */}
        <img src={src} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      </div>
    );
  }

  return null;
}

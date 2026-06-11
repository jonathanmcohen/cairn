import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { signFileUrl } from '@/lib/files/signing';
import { clampAccessiblePrimary, hexToHslTriplet, normalizeHexColor } from './brand-color';

type Db = PostgresJsDatabase<typeof schema>;

export type BrandErrorCode = 'INVALID_COLOR' | 'LOGO_NOT_IN_WORKSPACE';

export class BrandError extends Error {
  constructor(
    public code: BrandErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'BrandError';
  }
}

/** Same TTL as the public-page resign path (src/lib/pages/public.ts). */
const BRAND_LOGO_TTL_SECONDS = 60 * 60;

export type WorkspaceBrand = {
  logoFileId: string | null;
  /** HMAC-signed `/api/files/<id>?sig=&exp=` URL (1 h TTL), or null. */
  logoUrl: string | null;
  /** Stored normalized '#rrggbb' hex as the admin picked it, or null. */
  primaryColor: string | null;
  /**
   * Render-ready primary, contrast-clamped at READ time (defense: rows
   * written by other paths still clamp here). `hex` is the clamped color,
   * `hsl` the "H S% L%" channel triplet the theme tokens consume.
   */
  appliedPrimary: { hex: string; hsl: string; clamped: boolean } | null;
};

const EMPTY_BRAND: WorkspaceBrand = {
  logoFileId: null,
  logoUrl: null,
  primaryColor: null,
  appliedPrimary: null,
};

/**
 * Read a workspace's brand. The logo URL is minted exactly like
 * `resignDocumentImages` mints public-page image URLs — HMAC-signed via
 * `signFileUrl`, never a raw path (house rule). A stored color that fails to
 * parse (hand-edited row) is treated as unset rather than throwing — brand is
 * cosmetic and must never 500 a page.
 */
export async function getWorkspaceBrand(
  db: Db,
  workspaceId: string,
  opts: { secret: string },
): Promise<WorkspaceBrand> {
  const [row] = await db
    .select({
      logoFileId: schema.workspaces.brandLogoFileId,
      primaryColor: schema.workspaces.brandPrimaryColor,
    })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!row) return EMPTY_BRAND;

  let logoUrl: string | null = null;
  if (row.logoFileId) {
    const expiresAt = Math.floor(Date.now() / 1000) + BRAND_LOGO_TTL_SECONDS;
    const sig = signFileUrl({ fileId: row.logoFileId, expiresAt, secret: opts.secret });
    logoUrl = `/api/files/${row.logoFileId}?sig=${sig}&exp=${expiresAt}`;
  }

  const normalized = row.primaryColor ? normalizeHexColor(row.primaryColor) : null;
  let appliedPrimary: WorkspaceBrand['appliedPrimary'] = null;
  if (normalized) {
    const { color, clamped } = clampAccessiblePrimary(normalized);
    appliedPrimary = { hex: color, hsl: hexToHslTriplet(color), clamped };
  }

  return {
    logoFileId: row.logoFileId,
    logoUrl,
    primaryColor: normalized,
    appliedPrimary,
  };
}

export type SetWorkspaceBrandInput = {
  workspaceId: string;
  actorUserId: string;
  /** undefined = leave unchanged; null = clear; uuid = set (tenant-guarded). */
  logoFileId?: string | null;
  /** undefined = leave unchanged; null = clear; '#rrggbb' = set (validated). */
  primaryColor?: string | null;
};

/**
 * Persist the brand columns + audit. The logo file MUST belong to the same
 * workspace (tenant guard on files.workspace_id). The color is validated and
 * stored as normalized '#rrggbb' hex — the raw pick, NOT the clamped value, so
 * the settings UI round-trips what the admin chose; readers clamp at render.
 *
 * Audit metadata is { hasLogo, primaryColor } — the color value is not a
 * secret; hasLogo reflects the POST-update state.
 */
export async function setWorkspaceBrand(db: Db, input: SetWorkspaceBrandInput): Promise<void> {
  let normalizedColor: string | null | undefined = input.primaryColor;
  if (typeof input.primaryColor === 'string') {
    const norm = normalizeHexColor(input.primaryColor);
    if (!norm) {
      throw new BrandError('INVALID_COLOR', 'Primary color must be a #rrggbb hex value');
    }
    normalizedColor = norm;
  }

  await db.transaction(async (tx) => {
    if (typeof input.logoFileId === 'string') {
      const [file] = await tx
        .select({ id: schema.files.id })
        .from(schema.files)
        .where(
          and(
            eq(schema.files.id, input.logoFileId),
            eq(schema.files.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);
      if (!file) {
        throw new BrandError(
          'LOGO_NOT_IN_WORKSPACE',
          'Logo file must be an upload in this workspace',
        );
      }
    }

    const patch: Partial<typeof schema.workspaces.$inferInsert> = {};
    if (input.logoFileId !== undefined) patch.brandLogoFileId = input.logoFileId;
    if (normalizedColor !== undefined) patch.brandPrimaryColor = normalizedColor;
    if (Object.keys(patch).length === 0) return;

    const [updated] = await tx
      .update(schema.workspaces)
      .set(patch)
      .where(eq(schema.workspaces.id, input.workspaceId))
      .returning({
        brandLogoFileId: schema.workspaces.brandLogoFileId,
        brandPrimaryColor: schema.workspaces.brandPrimaryColor,
      });
    if (!updated) throw new Error('workspace missing');

    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'workspace.brand_updated',
      targetType: 'workspace',
      targetId: input.workspaceId,
      metadata: {
        hasLogo: updated.brandLogoFileId !== null,
        primaryColor: updated.brandPrimaryColor,
      },
    });
  });
}

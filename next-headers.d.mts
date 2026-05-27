/**
 * Type declarations for next-headers.mjs — the JS sibling of
 * src/lib/security/headers.ts. See next-headers.mjs preamble for why this
 * module exists separately from the .ts implementation.
 */

export type CspOptions = {
  collabUrl?: string;
  publicPath?: boolean;
  isProd?: boolean;
  nonce?: string;
};

export const EMBED_FRAME_HOSTS: readonly string[];

export function cspOrigin(raw: string | undefined): string | null;

export function cspNonce(csp: string | null | undefined): string | undefined;

export function buildCsp(opts?: CspOptions): string;

export function securityHeaders(opts?: { isProd?: boolean; publicPath?: boolean }): Array<{
  key: string;
  value: string;
}>;

export function headersFor(opts: {
  collabUrl?: string;
  isProd?: boolean;
  publicPath?: boolean;
  nonce?: string;
}): Array<{
  key: string;
  value: string;
}>;

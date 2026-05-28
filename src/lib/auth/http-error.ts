/**
 * Dependency-free `HttpError` used by route handlers and lib helpers.
 *
 * Extracted from `require-role.ts` to break a Playwright-time import chain:
 * the a11y test seed file (`tests/a11y/seed.ts`) imports `@/lib/pages/update`
 * which (since v0.9.0 P14) imports `@/lib/pages/lock`, which used to import
 * `HttpError` from `@/lib/auth/require-role`. `require-role` itself imports
 * `next/headers`, which Playwright's TS source loader (Node 22 ESM)
 * cannot resolve from a pure-source context — `next/headers` is a
 * package export only legal inside Next's bundling, so loading it via
 * source crashes the test runner before any spec executes.
 *
 * Moving `HttpError` here keeps the public name stable (require-role
 * re-exports for existing consumers) without dragging `next/headers`
 * into anyone who only wants the error class.
 */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

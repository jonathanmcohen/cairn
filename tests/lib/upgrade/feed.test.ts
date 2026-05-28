/**
 * v0.9.0 G8 P42 — release-watch feed parser tests.
 *
 * Pure module — no DB. Tests cover semver comparison, GitHub releases JSON
 * parsing, draft/prerelease filtering, rate-limit handling, and non-200
 * defensive responses.
 */
import { describe, expect, it } from 'vitest';
import { compareVersions, fetchReleaseFeed } from '@/lib/upgrade/feed';

describe('compareVersions', () => {
  it('flags newer when latest > current', () => {
    expect(compareVersions({ current: '0.9.0', latest: '0.9.1' }).isNewer).toBe(true);
  });
  it('flags not-newer when equal', () => {
    expect(compareVersions({ current: '0.9.0', latest: '0.9.0' }).isNewer).toBe(false);
  });
  it('flags not-newer when current > latest', () => {
    expect(compareVersions({ current: '0.9.5', latest: '0.9.1' }).isNewer).toBe(false);
  });
  it('strips a leading v from tags', () => {
    expect(compareVersions({ current: '0.9.0', latest: 'v0.9.1' }).isNewer).toBe(true);
  });
  it('rejects unparseable tags safely', () => {
    expect(compareVersions({ current: '0.9.0', latest: 'not-a-version' }).isNewer).toBe(false);
  });
});

describe('fetchReleaseFeed', () => {
  it('parses a GitHub releases JSON array and returns the highest tag', async () => {
    const fakeFetch = async (): Promise<Response> =>
      new Response(
        JSON.stringify([
          {
            tag_name: 'v0.8.0',
            html_url: 'https://github.com/x/y/releases/tag/v0.8.0',
            draft: false,
            prerelease: false,
          },
          {
            tag_name: 'v0.9.1',
            html_url: 'https://github.com/x/y/releases/tag/v0.9.1',
            draft: false,
            prerelease: false,
          },
          {
            tag_name: 'v0.9.0',
            html_url: 'https://github.com/x/y/releases/tag/v0.9.0',
            draft: false,
            prerelease: false,
          },
        ]),
        { status: 200 },
      );
    const result = await fetchReleaseFeed({
      url: 'https://api.github.com/x',
      fetchImpl: fakeFetch as typeof fetch,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.latestTag).toBe('0.9.1');
      expect(result.releaseNotesUrl).toContain('v0.9.1');
    }
  });

  it('skips drafts and prereleases', async () => {
    const fakeFetch = async (): Promise<Response> =>
      new Response(
        JSON.stringify([
          { tag_name: 'v1.0.0-rc.1', html_url: 'x', draft: false, prerelease: true },
          { tag_name: 'v0.9.0', html_url: 'x', draft: false, prerelease: false },
          { tag_name: 'v2.0.0-draft', html_url: 'x', draft: true, prerelease: false },
        ]),
        { status: 200 },
      );
    const result = await fetchReleaseFeed({ url: 'x', fetchImpl: fakeFetch as typeof fetch });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.latestTag).toBe('0.9.0');
  });

  it('returns ok=false with reason on GitHub rate-limit response', async () => {
    const fakeFetch = async (): Promise<Response> =>
      new Response('{"message":"API rate limit exceeded"}', {
        status: 403,
        headers: { 'X-RateLimit-Remaining': '0' },
      });
    const result = await fetchReleaseFeed({ url: 'x', fetchImpl: fakeFetch as typeof fetch });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/rate limit/i);
  });

  it('returns ok=false on non-200 without throwing', async () => {
    const fakeFetch = async (): Promise<Response> => new Response('Not Found', { status: 404 });
    const result = await fetchReleaseFeed({ url: 'x', fetchImpl: fakeFetch as typeof fetch });
    expect(result.ok).toBe(false);
  });

  it('returns ok=false on network error without throwing', async () => {
    const fakeFetch = async (): Promise<Response> => {
      throw new Error('econnrefused');
    };
    const result = await fetchReleaseFeed({ url: 'x', fetchImpl: fakeFetch as typeof fetch });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('econnrefused');
  });

  it('returns ok=false when feed body is not an array', async () => {
    const fakeFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ message: 'not-found' }), { status: 200 });
    const result = await fetchReleaseFeed({ url: 'x', fetchImpl: fakeFetch as typeof fetch });
    expect(result.ok).toBe(false);
  });
});

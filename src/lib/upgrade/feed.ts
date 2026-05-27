/**
 * v0.9.0 G8 P42 — release-watch feed parser + semver compare.
 *
 * Pure module. Fetches a GitHub-releases-shaped JSON feed; returns
 * `{ ok, latestTag, releaseNotesUrl }` or `{ ok:false, reason }`. Handles
 * the GitHub API rate-limit response without throwing. No DB writes.
 */
import semver from 'semver';

export type ReleaseFeedResult =
  | { ok: true; latestTag: string; releaseNotesUrl: string }
  | { ok: false; reason: string };

export type GitHubRelease = {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
};

export async function fetchReleaseFeed(input: {
  url: string;
  fetchImpl?: typeof fetch;
}): Promise<ReleaseFeedResult> {
  const f = input.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(input.url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'cairn-release-watch',
      },
    });
  } catch (err) {
    return { ok: false, reason: `network: ${(err as Error).message}` };
  }
  if (res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0') {
    return { ok: false, reason: 'GitHub API rate limit exceeded' };
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'feed body not JSON' };
  }
  if (!Array.isArray(body)) return { ok: false, reason: 'feed body not an array' };

  const tags = (body as GitHubRelease[])
    .filter((r) => !r.draft && !r.prerelease)
    .map((r) => ({ tag: stripV(r.tag_name), url: r.html_url }))
    .filter((r) => semver.valid(r.tag));

  if (tags.length === 0) return { ok: false, reason: 'no stable tags in feed' };

  const sorted = tags.sort((a, b) => semver.rcompare(a.tag, b.tag));
  // biome-ignore lint/style/noNonNullAssertion: length checked above
  const top = sorted[0]!;
  return { ok: true, latestTag: top.tag, releaseNotesUrl: top.url };
}

export function compareVersions(input: { current: string; latest: string }): {
  isNewer: boolean;
} {
  const c = stripV(input.current);
  const l = stripV(input.latest);
  if (!semver.valid(c) || !semver.valid(l)) return { isNewer: false };
  return { isNewer: semver.gt(l, c) };
}

function stripV(t: string): string {
  return t.startsWith('v') ? t.slice(1) : t;
}

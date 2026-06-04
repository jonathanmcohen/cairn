import { expect, it } from 'vitest';
import { previewPublicSlug } from '@/lib/pages/publish';

it('reuses an existing slug when present (#70/#249)', () => {
  expect(previewPublicSlug({ title: 'Whatever', publicSlug: 'docs-abc123' })).toBe('docs-abc123');
});
it('previews a stable slug base from the title when never published', () => {
  expect(previewPublicSlug({ title: 'My Launch Plan!', publicSlug: null })).toBe('my-launch-plan');
});
it('falls back to "page" for an empty title', () => {
  expect(previewPublicSlug({ title: '', publicSlug: null })).toBe('page');
});

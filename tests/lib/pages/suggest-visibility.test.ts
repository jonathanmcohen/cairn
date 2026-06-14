import { describe, expect, it } from 'vitest';
import { shouldShowSuggestEdits } from '@/lib/pages/suggest-visibility';

describe('shouldShowSuggestEdits', () => {
  it('hides the chip on a page the current user owns that is still a draft', () => {
    expect(shouldShowSuggestEdits({ isOwner: true, status: 'draft' })).toBe(false);
  });

  // Failure-mode coverage (plan Q-5): the chip must still show when the page
  // has left draft, OR when the viewer is not the owner.
  it('shows the chip once an owned page leaves draft', () => {
    expect(shouldShowSuggestEdits({ isOwner: true, status: 'review' })).toBe(true);
    expect(shouldShowSuggestEdits({ isOwner: true, status: 'published' })).toBe(true);
    expect(shouldShowSuggestEdits({ isOwner: true, status: 'archived' })).toBe(true);
  });

  it("shows the chip on someone else's page regardless of status", () => {
    expect(shouldShowSuggestEdits({ isOwner: false, status: 'draft' })).toBe(true);
    expect(shouldShowSuggestEdits({ isOwner: false, status: 'published' })).toBe(true);
  });
});
